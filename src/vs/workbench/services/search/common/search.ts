/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mapArrayOrNot } from 'vs/base/common/arrays';
import { CancellationToken } from 'vs/base/common/cancellation';
import * as glob from 'vs/base/common/glob';
import { IDisposable } from 'vs/base/common/lifecycle';
import * as objects from 'vs/base/common/objects';
import * as extpath from 'vs/base/common/extpath';
import { getNLines } from 'vs/base/common/strings';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IFilesConfiguration } from 'vs/platform/files/common/files';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ITelemetryData } from 'vs/platform/telemetry/common/telemetry';
import { Event } from 'vs/base/common/event';
import { ViewContainer, IViewContainersRegistry, Extensions as ViewContainerExtensions } from 'vs/workbench/common/views';
import { Registry } from 'vs/platform/registry/common/platform';

export const VIEWLET_ID = 'workbench.view.search';
export const PANEL_ID = 'workbench.view.search';
export const VIEW_ID = 'workbench.view.search';
/**
 * Search viewlet container.
 */
export const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer(VIEWLET_ID, true);

export const ISearchService = createDecorator<ISearchService>('searchService');

/**
 * A service that enables to search for files or with in files.
 */
export interface ISearchService {
	_serviceBrand: undefined;
	textSearch(query: ITextQuery, token?: CancellationToken, onProgress?: (result: ISearchProgressItem) => void): Promise<ISearchComplete>;
	fileSearch(query: IFileQuery, token?: CancellationToken): Promise<ISearchComplete>;
	clearCache(cacheKey: string): Promise<void>;
	registerSearchResultProvider(scheme: string, type: SearchProviderType, provider: ISearchResultProvider): IDisposable;
}

/**
 * TODO@roblou - split text from file search entirely, or share code in a more natural way.
 */
export const enum SearchProviderType {
	file,
	text
}

export interface ISearchResultProvider {
	textSearch(query: ITextQuery, onProgress?: (p: ISearchProgressItem) => void, token?: CancellationToken): Promise<ISearchComplete>;
	fileSearch(query: IFileQuery, token?: CancellationToken): Promise<ISearchComplete>;
	clearCache(cacheKey: string): Promise<void>;
}

export interface IFolderQuery<U extends UriComponents = URI> {
	folder: U;
	excludePattern?: glob.IExpression;
	includePattern?: glob.IExpression;
	fileEncoding?: string;
	disregardIgnoreFiles?: boolean;
	disregardGlobalIgnoreFiles?: boolean;
	ignoreSymlinks?: boolean;
}

export interface ICommonQueryProps<U extends UriComponents> {
	/** For telemetry - indicates what is triggering the source */
	_reason?: string;

	folderQueries: IFolderQuery<U>[];
	includePattern?: glob.IExpression;
	excludePattern?: glob.IExpression;
	extraFileResources?: U[];

	maxResults?: number;
	usingSearchPaths?: boolean;
}

export interface IFileQueryProps<U extends UriComponents> extends ICommonQueryProps<U> {
	type: QueryType.File;
	filePattern?: string;

	/**
	 * If true no results will be returned. Instead `limitHit` will indicate if at least one result exists or not.
	 * Currently does not work with queries including a 'siblings clause'.
	 */
	exists?: boolean;
	sortByScore?: boolean;
	cacheKey?: string;
}

export interface ITextQueryProps<U extends UriComponents> extends ICommonQueryProps<U> {
	type: QueryType.Text;
	contentPattern: IPatternInfo;

	previewOptions?: ITextSearchPreviewOptions;
	maxFileSize?: number;
	usePCRE2?: boolean;
	afterContext?: number;
	beforeContext?: number;

	userDisabledExcludesAndIgnoreFiles?: boolean;
}

export type IFileQuery = IFileQueryProps<URI>;
export type IRawFileQuery = IFileQueryProps<UriComponents>;
export type ITextQuery = ITextQueryProps<URI>;
export type IRawTextQuery = ITextQueryProps<UriComponents>;

export type IRawQuery = IRawTextQuery | IRawFileQuery;
export type ISearchQuery = ITextQuery | IFileQuery;

export const enum QueryType {
	File = 1,
	Text = 2
}

/* __GDPR__FRAGMENT__
	"IPatternInfo" : {
		"pattern" : { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		"isRegExp": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
		"isWordMatch": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
		"wordSeparators": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"isMultiline": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
		"isCaseSensitive": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
		"isSmartCase": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
	}
*/
export interface IPatternInfo {
	pattern: string;
	isRegExp?: boolean;
	isWordMatch?: boolean;
	wordSeparators?: string;
	isMultiline?: boolean;
	isUnicode?: boolean;
	isCaseSensitive?: boolean;
}

export interface IExtendedExtensionSearchOptions {
	usePCRE2?: boolean;
}

export interface IFileMatch<U extends UriComponents = URI> {
	resource: U;
	results?: ITextSearchResult[];
}

export type IRawFileMatch2 = IFileMatch<UriComponents>;

export interface ITextSearchPreviewOptions {
	matchLines: number;
	charsPerLine: number;
}

export interface ISearchRange {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
}

export interface ITextSearchResultPreview {
	text: string;
	matches: ISearchRange | ISearchRange[];
}

export interface ITextSearchMatch {
	uri?: URI;
	ranges: ISearchRange | ISearchRange[];
	preview: ITextSearchResultPreview;
}

export interface ITextSearchContext {
	uri?: URI;
	text: string;
	lineNumber: number;
}

export type ITextSearchResult = ITextSearchMatch | ITextSearchContext;

export function resultIsMatch(result: ITextSearchResult): result is ITextSearchMatch {
	return !!(<ITextSearchMatch>result).preview;
}

export interface IProgressMessage {
	message?: string;
}

export type ISearchProgressItem = IFileMatch | IProgressMessage;

export function isFileMatch(p: ISearchProgressItem): p is IFileMatch {
	return !!(<IFileMatch>p).resource;
}

export function isProgressMessage(p: ISearchProgressItem): p is IProgressMessage {
	return !isFileMatch(p);
}

export interface ISearchCompleteStats {
	limitHit?: boolean;
	stats?: IFileSearchStats | ITextSearchStats;
}

export interface ISearchComplete extends ISearchCompleteStats {
	results: IFileMatch[];
}

export interface ITextSearchStats {
	type: 'textSearchProvider' | 'searchProcess';
}

export interface IFileSearchStats {
	fromCache: boolean;
	detailStats: ISearchEngineStats | ICachedSearchStats | IFileSearchProviderStats;

	resultCount: number;
	type: 'fileSearchProvider' | 'searchProcess';
	sortingTime?: number;
}

export interface ICachedSearchStats {
	cacheWasResolved: boolean;
	cacheLookupTime: number;
	cacheFilterTime: number;
	cacheEntryCount: number;
}

export interface ISearchEngineStats {
	fileWalkTime: number;
	directoriesWalked: number;
	filesWalked: number;
	cmdTime: number;
	cmdResultCount?: number;
}

export interface IFileSearchProviderStats {
	providerTime: number;
	postProcessTime: number;
}

export class FileMatch implements IFileMatch {
	results: ITextSearchResult[] = [];
	constructor(public resource: URI) {
		// empty
	}
}

export class TextSearchMatch implements ITextSearchMatch {
	ranges: ISearchRange | ISearchRange[];
	preview: ITextSearchResultPreview;

	constructor(text: string, range: ISearchRange | ISearchRange[], previewOptions?: ITextSearchPreviewOptions) {
		this.ranges = range;

		if (previewOptions && previewOptions.matchLines === 1 && (!Array.isArray(range) || range.length === 1)) {
			const oneRange = Array.isArray(range) ? range[0] : range;

			// 1 line preview requested
			text = getNLines(text, previewOptions.matchLines);
			const leadingChars = Math.floor(previewOptions.charsPerLine / 5);
			const previewStart = Math.max(oneRange.startColumn - leadingChars, 0);
			const previewText = text.substring(previewStart, previewOptions.charsPerLine + previewStart);

			const endColInPreview = (oneRange.endLineNumber - oneRange.startLineNumber + 1) <= previewOptions.matchLines ?
				Math.min(previewText.length, oneRange.endColumn - previewStart) :  // if number of match lines will not be trimmed by previewOptions
				previewText.length; // if number of lines is trimmed

			const oneLineRange = new OneLineRange(0, oneRange.startColumn - previewStart, endColInPreview);
			this.preview = {
				text: previewText,
				matches: Array.isArray(range) ? [oneLineRange] : oneLineRange
			};
		} else {
			const firstMatchLine = Array.isArray(range) ? range[0].startLineNumber : range.startLineNumber;

			// n line, no preview requested, or multiple matches in the preview
			this.preview = {
				text,
				matches: mapArrayOrNot(range, r => new SearchRange(r.startLineNumber - firstMatchLine, r.startColumn, r.endLineNumber - firstMatchLine, r.endColumn))
			};
		}
	}
}

export class SearchRange implements ISearchRange {
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;

	constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
		this.startLineNumber = startLineNumber;
		this.startColumn = startColumn;
		this.endLineNumber = endLineNumber;
		this.endColumn = endColumn;
	}
}

export class OneLineRange extends SearchRange {
	constructor(lineNumber: number, startColumn: number, endColumn: number) {
		super(lineNumber, startColumn, lineNumber, endColumn);
	}
}

export interface ISearchConfigurationProperties {
	exclude: glob.IExpression;
	useRipgrep: boolean;
	/**
	 * Use ignore file for file search.
	 */
	useIgnoreFiles: boolean;
	useGlobalIgnoreFiles: boolean;
	followSymlinks: boolean;
	smartCase: boolean;
	globalFindClipboard: boolean;
	location: 'sidebar' | 'panel';
	useReplacePreview: boolean;
	showLineNumbers: boolean;
	usePCRE2: boolean;
	actionsPosition: 'auto' | 'right';
	maintainFileSearchCache: boolean;
	collapseResults: 'auto' | 'alwaysCollapse' | 'alwaysExpand';
}

export interface ISearchConfiguration extends IFilesConfiguration {
	search: ISearchConfigurationProperties;
	editor: {
		wordSeparators: string;
	};
}

export function getExcludes(configuration: ISearchConfiguration, includeSearchExcludes = true): glob.IExpression | undefined {
	const fileExcludes = configuration && configuration.files && configuration.files.exclude;
	const searchExcludes = includeSearchExcludes && configuration && configuration.search && configuration.search.exclude;

	if (!fileExcludes && !searchExcludes) {
		return undefined;
	}

	if (!fileExcludes || !searchExcludes) {
		return fileExcludes || searchExcludes;
	}

	let allExcludes: glob.IExpression = Object.create(null);
	// clone the config as it could be frozen
	allExcludes = objects.mixin(allExcludes, objects.deepClone(fileExcludes));
	allExcludes = objects.mixin(allExcludes, objects.deepClone(searchExcludes), true);

	return allExcludes;
}

export function pathIncludedInQuery(queryProps: ICommonQueryProps<URI>, fsPath: string): boolean {
	if (queryProps.excludePattern && glob.match(queryProps.excludePattern, fsPath)) {
		return false;
	}

	if (queryProps.includePattern && !glob.match(queryProps.includePattern, fsPath)) {
		return false;
	}

	// If searchPaths are being used, the extra file must be in a subfolder and match the pattern, if present
	if (queryProps.usingSearchPaths) {
		return !!queryProps.folderQueries && queryProps.folderQueries.every(fq => {
			const searchPath = fq.folder.fsPath;
			if (extpath.isEqualOrParent(fsPath, searchPath)) {
				return !fq.includePattern || !!glob.match(fq.includePattern, fsPath);
			} else {
				return false;
			}
		});
	}

	return true;
}

export enum SearchErrorCode {
	unknownEncoding = 1,
	regexParseError,
	globParseError,
	invalidLiteral,
	rgProcessError,
	other
}

export class SearchError extends Error {
	constructor(message: string, readonly code?: SearchErrorCode) {
		super(message);
	}
}

export function deserializeSearchError(errorMsg: string): SearchError {
	try {
		const details = JSON.parse(errorMsg);
		return new SearchError(details.message, details.code);
	} catch (e) {
		return new SearchError(errorMsg, SearchErrorCode.other);
	}
}

export function serializeSearchError(searchError: SearchError): Error {
	const details = { message: searchError.message, code: searchError.code };
	return new Error(JSON.stringify(details));
}
export interface ITelemetryEvent {
	eventName: string;
	data: ITelemetryData;
}

export interface IRawSearchService {
	fileSearch(search: IRawFileQuery): Event<ISerializedSearchProgressItem | ISerializedSearchComplete>;
	textSearch(search: IRawTextQuery): Event<ISerializedSearchProgressItem | ISerializedSearchComplete>;
	clearCache(cacheKey: string): Promise<void>;
}

export interface IRawFileMatch {
	base?: string;
	relativePath: string;
	basename: string;
	size?: number;
}

export interface ISearchEngine<T> {
	search: (onResult: (matches: T) => void, onProgress: (progress: IProgressMessage) => void, done: (error: Error | null, complete: ISearchEngineSuccess) => void) => void;
	cancel: () => void;
}

export interface ISerializedSearchSuccess {
	type: 'success';
	limitHit: boolean;
	stats?: IFileSearchStats | ITextSearchStats;
}

export interface ISearchEngineSuccess {
	limitHit: boolean;
	stats: ISearchEngineStats;
}

export interface ISerializedSearchError {
	type: 'error';
	error: {
		message: string,
		stack: string
	};
}

export type ISerializedSearchComplete = ISerializedSearchSuccess | ISerializedSearchError;

export function isSerializedSearchComplete(arg: ISerializedSearchProgressItem | ISerializedSearchComplete): arg is ISerializedSearchComplete {
	if ((arg as any).type === 'error') {
		return true;
	} else if ((arg as any).type === 'success') {
		return true;
	} else {
		return false;
	}
}

export function isSerializedSearchSuccess(arg: ISerializedSearchComplete): arg is ISerializedSearchSuccess {
	return arg.type === 'success';
}

export function isSerializedFileMatch(arg: ISerializedSearchProgressItem): arg is ISerializedFileMatch {
	return !!(<ISerializedFileMatch>arg).path;
}

export interface ISerializedFileMatch {
	path: string;
	results?: ITextSearchResult[];
	numMatches?: number;
}

// Type of the possible values for progress calls from the engine
export type ISerializedSearchProgressItem = ISerializedFileMatch | ISerializedFileMatch[] | IProgressMessage;
export type IFileSearchProgressItem = IRawFileMatch | IRawFileMatch[] | IProgressMessage;


export class SerializableFileMatch implements ISerializedFileMatch {
	path: string;
	results: ITextSearchMatch[];

	constructor(path: string) {
		this.path = path;
		this.results = [];
	}

	addMatch(match: ITextSearchMatch): void {
		this.results.push(match);
	}

	serialize(): ISerializedFileMatch {
		return {
			path: this.path,
			results: this.results,
			numMatches: this.results.length
		};
	}
}

/**
 *  Computes the patterns that the provider handles. Discards sibling clauses and 'false' patterns
 */
export function resolvePatternsForProvider(globalPattern: glob.IExpression | undefined, folderPattern: glob.IExpression | undefined): string[] {
	const merged = {
		...(globalPattern || {}),
		...(folderPattern || {})
	};

	return Object.keys(merged)
		.filter(key => {
			const value = merged[key];
			return typeof value === 'boolean' && value;
		});
}

export class QueryGlobTester {

	private _excludeExpression: glob.IExpression;
	private _parsedExcludeExpression: glob.ParsedExpression;

	private _parsedIncludeExpression: glob.ParsedExpression | null = null;

	constructor(config: ISearchQuery, folderQuery: IFolderQuery) {
		this._excludeExpression = {
			...(config.excludePattern || {}),
			...(folderQuery.excludePattern || {})
		};
		this._parsedExcludeExpression = glob.parse(this._excludeExpression);

		// Empty includeExpression means include nothing, so no {} shortcuts
		let includeExpression: glob.IExpression | undefined = config.includePattern;
		if (folderQuery.includePattern) {
			if (includeExpression) {
				includeExpression = {
					...includeExpression,
					...folderQuery.includePattern
				};
			} else {
				includeExpression = folderQuery.includePattern;
			}
		}

		if (includeExpression) {
			this._parsedIncludeExpression = glob.parse(includeExpression);
		}
	}

	/**
	 * Guaranteed sync - siblingsFn should not return a promise.
	 */
	includedInQuerySync(testPath: string, basename?: string, hasSibling?: (name: string) => boolean): boolean {
		if (this._parsedExcludeExpression && this._parsedExcludeExpression(testPath, basename, hasSibling)) {
			return false;
		}

		if (this._parsedIncludeExpression && !this._parsedIncludeExpression(testPath, basename, hasSibling)) {
			return false;
		}

		return true;
	}

	/**
	 * Guaranteed async.
	 */
	includedInQuery(testPath: string, basename?: string, hasSibling?: (name: string) => boolean | Promise<boolean>): Promise<boolean> {
		const excludeP = this._parsedExcludeExpression ?
			Promise.resolve(this._parsedExcludeExpression(testPath, basename, hasSibling)).then(result => !!result) :
			Promise.resolve(false);

		return excludeP.then(excluded => {
			if (excluded) {
				return false;
			}

			return this._parsedIncludeExpression ?
				Promise.resolve(this._parsedIncludeExpression(testPath, basename, hasSibling)).then(result => !!result) :
				Promise.resolve(true);
		}).then(included => {
			return included;
		});
	}

	hasSiblingExcludeClauses(): boolean {
		return hasSiblingClauses(this._excludeExpression);
	}
}

function hasSiblingClauses(pattern: glob.IExpression): boolean {
	for (const key in pattern) {
		if (typeof pattern[key] !== 'boolean') {
			return true;
		}
	}

	return false;
}
