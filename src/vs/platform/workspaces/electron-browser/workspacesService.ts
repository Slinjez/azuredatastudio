/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { IWorkspacesService, IWorkspaceIdentifier, IWorkspaceFolderCreationData, reviveWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { IMainProcessService } from 'vs/platform/ipc/electron-browser/mainProcessService';
import { URI } from 'vs/base/common/uri';

export class WorkspacesService implements IWorkspacesService {

	_serviceBrand: undefined;

	private channel: IChannel;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		this.channel = mainProcessService.getChannel('workspaces');
	}

	createUntitledWorkspace(folders?: IWorkspaceFolderCreationData[], remoteAuthority?: string): Promise<IWorkspaceIdentifier> {
		return this.channel.call('createUntitledWorkspace', [folders, remoteAuthority]).then(reviveWorkspaceIdentifier);
	}

	deleteUntitledWorkspace(workspaceIdentifier: IWorkspaceIdentifier): Promise<void> {
		return this.channel.call('deleteUntitledWorkspace', workspaceIdentifier);
	}

	getWorkspaceIdentifier(configPath: URI): Promise<IWorkspaceIdentifier> {
		return this.channel.call('getWorkspaceIdentifier', configPath).then(reviveWorkspaceIdentifier);
	}
}
