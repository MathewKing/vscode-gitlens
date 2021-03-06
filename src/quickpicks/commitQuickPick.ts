'use strict';
import * as paths from 'path';
import { commands, Uri, window } from 'vscode';
import {
    Commands,
    CopyMessageToClipboardCommandArgs,
    CopyShaToClipboardCommandArgs,
    DiffDirectoryCommandArgs,
    DiffWithPreviousCommandArgs,
    ShowQuickCommitDetailsCommandArgs,
    StashApplyCommandArgs,
    StashDeleteCommandArgs
} from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import {
    GitFile,
    GitFileStatus,
    GitLog,
    GitLogCommit,
    GitStashCommit,
    GitUri,
    RemoteResourceType
} from '../git/gitService';
import { KeyCommand, KeyNoopCommand, Keys } from '../keyboard';
import { Arrays, Iterables, Strings } from '../system';
import {
    CommandQuickPickItem,
    getQuickPickIgnoreFocusOut,
    KeyCommandQuickPickItem,
    OpenFileCommandQuickPickItem,
    OpenFilesCommandQuickPickItem,
    QuickPickItem,
    ShowCommitInViewQuickPickItem
} from './commonQuickPicks';
import { OpenRemotesCommandQuickPickItem } from './remotesQuickPick';

export class CommitWithFileStatusQuickPickItem extends OpenFileCommandQuickPickItem {
    readonly status: GitFileStatus;

    readonly commit: GitLogCommit;

    constructor(commit: GitLogCommit, file: GitFile) {
        const octicon = GitFile.getStatusOcticon(file.status);
        const description = GitFile.getFormattedDirectory(file, true);

        super(GitUri.toRevisionUri(commit.sha, file, commit.repoPath), {
            label: `${Strings.pad(octicon, 4, 2)} ${paths.basename(file.fileName)}`,
            description: description
        });

        this.commit = commit.toFileCommit(file);
        this.status = file.status;
    }

    get sha(): string {
        return this.commit.sha;
    }

    onDidPressKey(key: Keys): Thenable<{} | undefined> {
        if (this.commit.previousSha === undefined) return super.onDidPressKey(key);

        const commandArgs: DiffWithPreviousCommandArgs = {
            commit: this.commit,
            showOptions: {
                preserveFocus: true,
                preview: false
            }
        };
        return commands.executeCommand(Commands.DiffWithPrevious, this.commit.toGitUri(), commandArgs);
    }
}

export class OpenCommitFilesCommandQuickPickItem extends OpenFilesCommandQuickPickItem {
    constructor(commit: GitLogCommit, versioned: boolean = false, item?: QuickPickItem) {
        const repoPath = commit.repoPath;
        const uris = Arrays.filterMap(commit.files, f => GitUri.fromFile(f, repoPath));

        super(
            uris,
            item || {
                label: '$(file-symlink-file) Open Files',
                description: ''
                // detail: `Opens all of the changed file in the working tree`
            }
        );
    }
}

export class OpenCommitFileRevisionsCommandQuickPickItem extends OpenFilesCommandQuickPickItem {
    constructor(commit: GitLogCommit, item?: QuickPickItem) {
        const uris = Arrays.filterMap(commit.files, f =>
            GitUri.toRevisionUri(f.status === 'D' ? commit.previousFileSha : commit.sha, f, commit.repoPath)
        );

        super(
            uris,
            item || {
                label: '$(file-symlink-file) Open Revisions',
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} in ${GlyphChars.Space}$(git-commit) ${
                    commit.shortSha
                }`
                // detail: `Opens all of the changed files in $(git-commit) ${commit.shortSha}`
            }
        );
    }
}

export class CommitQuickPick {
    static async show(
        commit: GitLogCommit,
        uri: Uri,
        goBackCommand?: CommandQuickPickItem,
        currentCommand?: CommandQuickPickItem,
        repoLog?: GitLog
    ): Promise<CommitWithFileStatusQuickPickItem | CommandQuickPickItem | undefined> {
        await commit.resolvePreviousFileSha();

        const items: (CommitWithFileStatusQuickPickItem | CommandQuickPickItem)[] = commit.files.map(
            fs => new CommitWithFileStatusQuickPickItem(commit, fs)
        );

        const stash = commit.isStash;

        let index = 0;

        if (stash) {
            const stashApplyCommmandArgs: StashApplyCommandArgs = {
                confirm: true,
                deleteAfter: false,
                stashItem: commit as GitStashCommit,
                goBackCommand: currentCommand
            };
            items.splice(
                index++,
                0,
                new CommandQuickPickItem(
                    {
                        label: '$(git-pull-request) Apply Stashed Changes',
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${commit.getShortMessage()}`
                    },
                    Commands.StashApply,
                    [stashApplyCommmandArgs]
                )
            );

            const stashDeleteCommmandArgs: StashDeleteCommandArgs = {
                confirm: true,
                stashItem: commit as GitStashCommit,
                goBackCommand: currentCommand
            };
            items.splice(
                index++,
                0,
                new CommandQuickPickItem(
                    {
                        label: '$(x) Delete Stashed Changes',
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${commit.getShortMessage()}`
                    },
                    Commands.StashDelete,
                    [stashDeleteCommmandArgs]
                )
            );

            items.splice(index++, 0, new ShowCommitInViewQuickPickItem(commit));
        }
        else {
            items.splice(index++, 0, new ShowCommitInViewQuickPickItem(commit));

            const remotes = await Container.git.getRemotes(commit.repoPath);
            if (remotes.length) {
                items.splice(
                    index++,
                    0,
                    new OpenRemotesCommandQuickPickItem(
                        remotes,
                        {
                            type: RemoteResourceType.Commit,
                            sha: commit.sha
                        },
                        currentCommand
                    )
                );
            }
        }

        items.splice(index++, 0, new OpenCommitFilesCommandQuickPickItem(commit));
        items.splice(index++, 0, new OpenCommitFileRevisionsCommandQuickPickItem(commit));

        let diffDirectoryCommmandArgs: DiffDirectoryCommandArgs = {
            ref1: commit.previousFileSha,
            ref2: commit.sha
        };
        items.splice(
            index++,
            0,
            new CommandQuickPickItem(
                {
                    label: '$(git-compare) Open Directory Compare with Previous Revision',
                    description: `${Strings.pad(GlyphChars.Dash, 2, 3)} $(git-commit) ${commit.previousFileShortSha} ${
                        GlyphChars.Space
                    } $(git-compare) ${GlyphChars.Space} $(git-commit) ${commit.shortSha}`
                },
                Commands.DiffDirectory,
                [commit.uri, diffDirectoryCommmandArgs]
            )
        );

        diffDirectoryCommmandArgs = {
            ref1: commit.sha
        };
        items.splice(
            index++,
            0,
            new CommandQuickPickItem(
                {
                    label: '$(git-compare) Open Directory Compare with Working Tree',
                    description: `${Strings.pad(GlyphChars.Dash, 2, 3)} $(git-commit) ${commit.shortSha} ${
                        GlyphChars.Space
                    } $(git-compare) ${GlyphChars.Space} $(file-directory) Working Tree`
                },
                Commands.DiffDirectory,
                [uri, diffDirectoryCommmandArgs]
            )
        );

        if (!stash) {
            const copyShaCommandArgs: CopyShaToClipboardCommandArgs = {
                sha: commit.sha
            };
            items.splice(
                index++,
                0,
                new CommandQuickPickItem(
                    {
                        label: '$(clippy) Copy Commit ID to Clipboard',
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${commit.shortSha}`
                    },
                    Commands.CopyShaToClipboard,
                    [uri, copyShaCommandArgs]
                )
            );
        }

        const copyMessageCommandArgs: CopyMessageToClipboardCommandArgs = {
            message: commit.message,
            sha: commit.sha
        };
        items.splice(
            index++,
            0,
            new CommandQuickPickItem(
                {
                    label: '$(clippy) Copy Commit Message to Clipboard',
                    description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${commit.getShortMessage()}`
                },
                Commands.CopyMessageToClipboard,
                [uri, copyMessageCommandArgs]
            )
        );

        const commitDetailsCommandArgs: ShowQuickCommitDetailsCommandArgs = {
            commit: commit,
            repoLog: repoLog,
            sha: commit.sha,
            goBackCommand: goBackCommand
        };
        items.splice(
            index++,
            0,
            new CommandQuickPickItem(
                {
                    label: 'Changed Files',
                    description: commit.getFormattedDiffStatus()
                },
                Commands.ShowQuickCommitDetails,
                [uri, commitDetailsCommandArgs]
            )
        );

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        let previousCommand: KeyCommand | (() => Promise<KeyCommand>) | undefined = undefined;
        let nextCommand: KeyCommand | (() => Promise<KeyCommand>) | undefined = undefined;
        if (!stash) {
            // If we have the full history, we are good
            if (repoLog !== undefined && !repoLog.truncated && repoLog.sha === undefined) {
                const previousCommandArgs: ShowQuickCommitDetailsCommandArgs = {
                    repoLog: repoLog,
                    sha: commit.previousSha,
                    goBackCommand: goBackCommand
                };
                previousCommand =
                    commit.previousSha === undefined
                        ? undefined
                        : new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [
                              commit.previousUri,
                              previousCommandArgs
                          ]);

                const nextCommandArgs: ShowQuickCommitDetailsCommandArgs = {
                    repoLog: repoLog,
                    sha: commit.nextSha,
                    goBackCommand: goBackCommand
                };
                nextCommand =
                    commit.nextSha === undefined
                        ? undefined
                        : new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [
                              commit.nextUri,
                              nextCommandArgs
                          ]);
            }
            else {
                previousCommand = async () => {
                    let log = repoLog;
                    let c = log && log.commits.get(commit.sha);

                    // If we can't find the commit or the previous commit isn't available (since it isn't trustworthy)
                    if (c === undefined || c.previousSha === undefined) {
                        log = await Container.git.getLog(commit.repoPath, {
                            maxCount: Container.config.advanced.maxListItems,
                            ref: commit.sha
                        });
                        c = log && log.commits.get(commit.sha);

                        if (c) {
                            // Copy over next info, since it is trustworthy at this point
                            c.nextSha = commit.nextSha;
                        }
                    }

                    if (c === undefined || c.previousSha === undefined) return KeyNoopCommand;

                    const previousCommandArgs: ShowQuickCommitDetailsCommandArgs = {
                        repoLog: log,
                        sha: c.previousSha,
                        goBackCommand: goBackCommand
                    };
                    return new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [
                        c.previousUri,
                        previousCommandArgs
                    ]);
                };

                nextCommand = async () => {
                    let log = repoLog;
                    let c = log && log.commits.get(commit.sha);

                    // If we can't find the commit or the next commit isn't available (since it isn't trustworthy)
                    if (c === undefined || c.nextSha === undefined) {
                        log = undefined;
                        c = undefined;

                        // Try to find the next commit
                        const nextLog = await Container.git.getLog(commit.repoPath, {
                            maxCount: 1,
                            reverse: true,
                            ref: commit.sha
                        });
                        const next = nextLog && Iterables.first(nextLog.commits.values());
                        if (next !== undefined && next.sha !== commit.sha) {
                            c = commit;
                            c.nextSha = next.sha;
                        }
                    }

                    if (c === undefined || c.nextSha === undefined) return KeyNoopCommand;

                    const nextCommandArgs: ShowQuickCommitDetailsCommandArgs = {
                        repoLog: log,
                        sha: c.nextSha,
                        goBackCommand: goBackCommand
                    };
                    return new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [c.nextUri, nextCommandArgs]);
                };
            }
        }

        const scope = await Container.keyboard.beginScope({
            left: goBackCommand,
            ',': previousCommand,
            '.': nextCommand
        });

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: `${commit.shortSha} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${
                commit.author ? `${commit.author}, ` : ''
            }${commit.formattedDate} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${commit.getShortMessage()}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                void scope.setKeyCommand('right', item);
                if (typeof item.onDidSelect === 'function') {
                    item.onDidSelect();
                }
            }
        });

        await scope.dispose();

        return pick;
    }
}
