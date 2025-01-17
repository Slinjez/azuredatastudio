/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResolvedAuthority, IRemoteAuthorityResolverService, ResolverResult } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { RemoteAuthorities } from 'vs/base/common/network';
import { URI, UriComponents } from 'vs/base/common/uri';

export class RemoteAuthorityResolverService implements IRemoteAuthorityResolverService {

	_serviceBrand: undefined;

	constructor(
		resourceUriProvider: ((uri: URI) => UriComponents) | undefined
	) {
		if (resourceUriProvider) {
			RemoteAuthorities.setDelegate(resourceUriProvider);
		}
	}

	resolveAuthority(authority: string): Promise<ResolverResult> {
		if (authority.indexOf(':') >= 0) {
			const pieces = authority.split(':');
			return Promise.resolve(this._createResolvedAuthority(authority, pieces[0], parseInt(pieces[1], 10)));
		}
		return Promise.resolve(this._createResolvedAuthority(authority, authority, 80));
	}

	private _createResolvedAuthority(authority: string, host: string, port: number): ResolverResult {
		RemoteAuthorities.set(authority, host, port);
		return { authority: { authority, host, port } };
	}

	clearResolvedAuthority(authority: string): void {
	}

	setResolvedAuthority(resolvedAuthority: ResolvedAuthority) {
	}

	setResolvedAuthorityError(authority: string, err: any): void {
	}
}
