/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITelemetryService, ITelemetryInfo, ITelemetryData } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService, combinedAppender, LogAppender } from 'vs/platform/telemetry/common/telemetryUtils';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Disposable } from 'vs/base/common/lifecycle';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IProductService } from 'vs/platform/product/common/product';
import { ISharedProcessService } from 'vs/platform/ipc/electron-browser/sharedProcessService';
import { TelemetryAppenderClient } from 'vs/platform/telemetry/node/telemetryIpc';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { resolveWorkbenchCommonProperties } from 'vs/platform/telemetry/node/workbenchCommonProperties';
import { TelemetryService as BaseTelemetryService, ITelemetryServiceConfig } from 'vs/platform/telemetry/common/telemetryService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ClassifiedEvent, StrictPropertyCheck, GDPRClassification } from 'vs/platform/telemetry/common/gdprTypings';

export class TelemetryService extends Disposable implements ITelemetryService {

	_serviceBrand: undefined;

	private impl: ITelemetryService;

	constructor(
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IProductService productService: IProductService,
		@ISharedProcessService sharedProcessService: ISharedProcessService,
		@ILogService logService: ILogService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super();

		if (!environmentService.isExtensionDevelopment && !environmentService.args['disable-telemetry'] && !!productService.enableTelemetry) {
			const channel = sharedProcessService.getChannel('telemetryAppender');
			const config: ITelemetryServiceConfig = {
				appender: combinedAppender(new TelemetryAppenderClient(channel), new LogAppender(logService)),
				commonProperties: resolveWorkbenchCommonProperties(storageService, productService.commit, productService.version, environmentService.configuration.machineId, productService.msftInternalDomains, environmentService.installSourcePath, environmentService.configuration.remoteAuthority),
				piiPaths: environmentService.extensionsPath ? [environmentService.appRoot, environmentService.extensionsPath] : [environmentService.appRoot]
			};

			this.impl = this._register(new BaseTelemetryService(config, configurationService));
		} else {
			this.impl = NullTelemetryService;
		}
	}

	setEnabled(value: boolean): void {
		return this.impl.setEnabled(value);
	}

	get isOptedIn(): boolean {
		return this.impl.isOptedIn;
	}

	publicLog(eventName: string, data?: ITelemetryData, anonymizeFilePaths?: boolean): Promise<void> {
		return this.impl.publicLog(eventName, data, anonymizeFilePaths);
	}

	publicLog2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyCheck<T, E>, anonymizeFilePaths?: boolean) {
		return this.publicLog(eventName, data as ITelemetryData, anonymizeFilePaths);
	}

	getTelemetryInfo(): Promise<ITelemetryInfo> {
		return this.impl.getTelemetryInfo();
	}
}

registerSingleton(ITelemetryService, TelemetryService);
