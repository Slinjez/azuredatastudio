/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import * as azdata from 'azdata';
import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();

import { TreeNode } from '../treeNode';
import { CmsResourceItemType } from '../constants';
import { CmsResourceTreeNodeBase } from './baseTreeNodes';
import { AppContext } from '../../appContext';
import { ICmsResourceTreeChangeHandler } from './treeChangeHandler';
import { RegisteredServerTreeNode } from './registeredServerTreeNode';
import { CmsResourceMessageTreeNode } from '../messageTreeNode';
import { CmsResourceTreeNode } from './cmsResourceTreeNode';

export class ServerGroupTreeNode extends CmsResourceTreeNodeBase {

	private _id: string = undefined;
	private _serverGroupNodes: ServerGroupTreeNode[] = [];

	constructor(
		name: string,
		description: string,
		private _relativePath: string,
		ownerUri: string,
		appContext: AppContext,
		treeChangeHandler: ICmsResourceTreeChangeHandler,
		parent: TreeNode
	) {
		super(name, description, ownerUri, appContext, treeChangeHandler, parent);
		this._id = `cms_serverGroup_${this.name}`;
	}
	public getChildren(): TreeNode[] | Promise<TreeNode[]> {
		try {
			let nodes = [];
			return this.appContext.apiWrapper.getRegisteredServers(this.ownerUri, this.relativePath).then((result) => {
				if (result) {
					if (result.registeredServersList) {
						result.registeredServersList.forEach((registeredServer) => {
							nodes.push(new RegisteredServerTreeNode(
								registeredServer.name,
								registeredServer.description,
								registeredServer.serverName,
								registeredServer.relativePath,
								this.ownerUri,
								this.appContext,
								this.treeChangeHandler, this));
						});
					}
					if (result.registeredServerGroups) {
						if (result.registeredServerGroups) {
							this._serverGroupNodes = [];
							result.registeredServerGroups.forEach((serverGroup) => {
								let serverGroupNode = new ServerGroupTreeNode(
									serverGroup.name,
									serverGroup.description,
									serverGroup.relativePath,
									this.ownerUri,
									this.appContext, this.treeChangeHandler, this);
								nodes.push(serverGroupNode);
								this._serverGroupNodes.push(serverGroupNode);
							});
						}
					}
					if (nodes.length > 0) {
						return nodes;
					} else {
						return [CmsResourceMessageTreeNode.create(CmsResourceTreeNode.noResourcesLabel, undefined)];
					}
				} else {
					return [CmsResourceMessageTreeNode.create(CmsResourceTreeNode.noResourcesLabel, undefined)];
				}
			});
		} catch {
			return [];
		}

	}

	public getTreeItem(): TreeItem | Promise<TreeItem> {
		let item = new TreeItem(this.name, TreeItemCollapsibleState.Collapsed);
		item.contextValue = CmsResourceItemType.serverGroup;
		item.id = this._id;
		item.tooltip = this.description;
		return item;
	}

	public getNodeInfo(): azdata.NodeInfo {
		return {
			label: this.name,
			isLeaf: false,
			errorMessage: undefined,
			metadata: undefined,
			nodePath: this.generateNodePath(),
			nodeStatus: undefined,
			nodeType: CmsResourceItemType.serverGroup,
			nodeSubType: undefined
		};
	}

	public get nodePathValue(): string {
		return this._id;
	}

	public get relativePath(): string {
		return this._relativePath;
	}

	public get serverGroupNodes(): ServerGroupTreeNode[] {
		return this._serverGroupNodes;
	}
}