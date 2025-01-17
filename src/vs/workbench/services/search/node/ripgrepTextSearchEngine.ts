/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'vs/base/common/path';
import { NodeStringDecoder, StringDecoder } from 'string_decoder';
import { createRegExp, startsWith, startsWithUTF8BOM, stripUTF8BOM, escapeRegExpCharacters, endsWith } from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { IExtendedExtensionSearchOptions, SearchError, SearchErrorCode, serializeSearchError } from 'vs/workbench/services/search/common/search';
import { rgPath } from 'vscode-ripgrep';
import { anchorGlob, createTextSearchResult, IOutputChannel, Maybe } from './ripgrepSearchUtils';
import { coalesce } from 'vs/base/common/arrays';
import { splitGlobAware } from 'vs/base/common/glob';
import { groupBy } from 'vs/base/common/collections';
import { TextSearchQuery, TextSearchOptions, TextSearchResult, TextSearchComplete, TextSearchPreviewOptions, TextSearchContext, TextSearchMatch, Range } from 'vs/workbench/services/search/common/searchExtTypes';
import { Progress } from 'vs/platform/progress/common/progress';
import { CancellationToken } from 'vs/base/common/cancellation';

// If vscode-ripgrep is in an .asar file, then the binary is unpacked.
const rgDiskPath = rgPath.replace(/\bnode_modules\.asar\b/, 'node_modules.asar.unpacked');

export class RipgrepTextSearchEngine {

	constructor(private outputChannel: IOutputChannel) { }

	provideTextSearchResults(query: TextSearchQuery, options: TextSearchOptions, progress: Progress<TextSearchResult>, token: CancellationToken): Promise<TextSearchComplete> {
		this.outputChannel.appendLine(`provideTextSearchResults ${query.pattern}, ${JSON.stringify({
			...options,
			...{
				folder: options.folder.toString()
			}
		})}`);

		return new Promise((resolve, reject) => {
			token.onCancellationRequested(() => cancel());

			const rgArgs = getRgArgs(query, options);

			const cwd = options.folder.fsPath;

			const escapedArgs = rgArgs
				.map(arg => arg.match(/^-/) ? arg : `'${arg}'`)
				.join(' ');
			this.outputChannel.appendLine(`rg ${escapedArgs}\n - cwd: ${cwd}`);

			let rgProc: Maybe<cp.ChildProcess> = cp.spawn(rgDiskPath, rgArgs, { cwd });
			rgProc.on('error', e => {
				console.error(e);
				this.outputChannel.appendLine('Error: ' + (e && e.message));
				reject(serializeSearchError(new SearchError(e && e.message, SearchErrorCode.rgProcessError)));
			});

			let gotResult = false;
			const ripgrepParser = new RipgrepParser(options.maxResults, cwd, options.previewOptions);
			ripgrepParser.on('result', (match: TextSearchResult) => {
				gotResult = true;
				progress.report(match);
			});

			let isDone = false;
			const cancel = () => {
				isDone = true;

				if (rgProc) {
					rgProc.kill();
				}

				if (ripgrepParser) {
					ripgrepParser.cancel();
				}
			};

			let limitHit = false;
			ripgrepParser.on('hitLimit', () => {
				limitHit = true;
				cancel();
			});

			rgProc.stdout.on('data', data => {
				ripgrepParser.handleData(data);
			});

			let gotData = false;
			rgProc.stdout.once('data', () => gotData = true);

			let stderr = '';
			rgProc.stderr.on('data', data => {
				const message = data.toString();
				this.outputChannel.appendLine(message);
				stderr += message;
			});

			rgProc.on('close', () => {
				this.outputChannel.appendLine(gotData ? 'Got data from stdout' : 'No data from stdout');
				this.outputChannel.appendLine(gotResult ? 'Got result from parser' : 'No result from parser');
				this.outputChannel.appendLine('');
				if (isDone) {
					resolve({ limitHit });
				} else {
					// Trigger last result
					ripgrepParser.flush();
					rgProc = null;
					let searchError: Maybe<SearchError>;
					if (stderr && !gotData && (searchError = rgErrorMsgForDisplay(stderr))) {
						reject(serializeSearchError(new SearchError(searchError.message, searchError.code)));
					} else {
						resolve({ limitHit });
					}
				}
			});
		});
	}
}

/**
 * Read the first line of stderr and return an error for display or undefined, based on a whitelist.
 * Ripgrep produces stderr output which is not from a fatal error, and we only want the search to be
 * "failed" when a fatal error was produced.
 */
export function rgErrorMsgForDisplay(msg: string): Maybe<SearchError> {
	const lines = msg.split('\n');
	const firstLine = lines[0].trim();

	if (lines.some(l => startsWith(l, 'regex parse error'))) {
		return new SearchError('Regex parse error', SearchErrorCode.regexParseError);
	}

	const match = firstLine.match(/grep config error: unknown encoding: (.*)/);
	if (match) {
		return new SearchError(`Unknown encoding: ${match[1]}`, SearchErrorCode.unknownEncoding);
	}

	if (startsWith(firstLine, 'error parsing glob')) {
		// Uppercase first letter
		return new SearchError(firstLine.charAt(0).toUpperCase() + firstLine.substr(1), SearchErrorCode.globParseError);
	}

	if (startsWith(firstLine, 'the literal')) {
		// Uppercase first letter
		return new SearchError(firstLine.charAt(0).toUpperCase() + firstLine.substr(1), SearchErrorCode.invalidLiteral);
	}

	if (startsWith(firstLine, 'PCRE2: error compiling pattern')) {
		return new SearchError(firstLine, SearchErrorCode.regexParseError);
	}

	return undefined;
}

export class RipgrepParser extends EventEmitter {
	private remainder = '';
	private isDone = false;
	private hitLimit = false;
	private stringDecoder: NodeStringDecoder;

	private numResults = 0;

	constructor(private maxResults: number, private rootFolder: string, private previewOptions?: TextSearchPreviewOptions) {
		super();
		this.stringDecoder = new StringDecoder();
	}

	cancel(): void {
		this.isDone = true;
	}

	flush(): void {
		this.handleDecodedData(this.stringDecoder.end());
	}


	on(event: 'result', listener: (result: TextSearchResult) => void): this;
	on(event: 'hitLimit', listener: () => void): this;
	on(event: string, listener: (...args: any[]) => void): this {
		super.on(event, listener);
		return this;
	}

	handleData(data: Buffer | string): void {
		if (this.isDone) {
			return;
		}

		const dataStr = typeof data === 'string' ? data : this.stringDecoder.write(data);
		this.handleDecodedData(dataStr);
	}

	private handleDecodedData(decodedData: string): void {
		// check for newline before appending to remainder
		let newlineIdx = decodedData.indexOf('\n');

		// If the previous data chunk didn't end in a newline, prepend it to this chunk
		const dataStr = this.remainder + decodedData;

		if (newlineIdx >= 0) {
			newlineIdx += this.remainder.length;
		} else {
			// Shortcut
			this.remainder = dataStr;
			return;
		}

		let prevIdx = 0;
		while (newlineIdx >= 0) {
			this.handleLine(dataStr.substring(prevIdx, newlineIdx).trim());
			prevIdx = newlineIdx + 1;
			newlineIdx = dataStr.indexOf('\n', prevIdx);
		}

		this.remainder = dataStr.substring(prevIdx);
	}

	private handleLine(outputLine: string): void {
		if (this.isDone || !outputLine) {
			return;
		}

		let parsedLine: IRgMessage;
		try {
			parsedLine = JSON.parse(outputLine);
		} catch (e) {
			throw new Error(`malformed line from rg: ${outputLine}`);
		}

		if (parsedLine.type === 'match') {
			const matchPath = bytesOrTextToString(parsedLine.data.path);
			const uri = URI.file(path.join(this.rootFolder, matchPath));
			const result = this.createTextSearchMatch(parsedLine.data, uri);
			this.onResult(result);

			if (this.hitLimit) {
				this.cancel();
				this.emit('hitLimit');
			}
		} else if (parsedLine.type === 'context') {
			const contextPath = bytesOrTextToString(parsedLine.data.path);
			const uri = URI.file(path.join(this.rootFolder, contextPath));
			const result = this.createTextSearchContext(parsedLine.data, uri);
			result.forEach(r => this.onResult(r));
		}
	}

	private createTextSearchMatch(data: IRgMatch, uri: URI): TextSearchMatch {
		const lineNumber = data.line_number - 1;
		let isBOMStripped = false;
		let fullText = bytesOrTextToString(data.lines);
		if (lineNumber === 0 && startsWithUTF8BOM(fullText)) {
			isBOMStripped = true;
			fullText = stripUTF8BOM(fullText);
		}
		const fullTextBytes = Buffer.from(fullText);

		let prevMatchEnd = 0;
		let prevMatchEndCol = 0;
		let prevMatchEndLine = lineNumber;
		const ranges = coalesce(data.submatches.map((match, i) => {
			if (this.hitLimit) {
				return null;
			}

			this.numResults++;
			if (this.numResults >= this.maxResults) {
				// Finish the line, then report the result below
				this.hitLimit = true;
			}

			let matchText = bytesOrTextToString(match.match);
			if (lineNumber === 0 && i === 0 && isBOMStripped) {
				matchText = stripUTF8BOM(matchText);
				match.start = match.start <= 3 ? 0 : match.start - 3;
				match.end = match.end <= 3 ? 0 : match.end - 3;
			}
			const inBetweenChars = fullTextBytes.slice(prevMatchEnd, match.start).toString().length;
			let startCol = prevMatchEndCol + inBetweenChars;

			const stats = getNumLinesAndLastNewlineLength(matchText);
			const startLineNumber = prevMatchEndLine;
			const endLineNumber = stats.numLines + startLineNumber;
			let endCol = stats.numLines > 0 ?
				stats.lastLineLength :
				stats.lastLineLength + startCol;

			prevMatchEnd = match.end;
			prevMatchEndCol = endCol;
			prevMatchEndLine = endLineNumber;

			return new Range(startLineNumber, startCol, endLineNumber, endCol);
		}));

		return createTextSearchResult(uri, fullText, <Range[]>ranges, this.previewOptions);
	}

	private createTextSearchContext(data: IRgMatch, uri: URI): TextSearchContext[] {
		const text = bytesOrTextToString(data.lines);
		const startLine = data.line_number;
		return text
			.replace(/\r?\n$/, '')
			.split('\n')
			.map((line, i) => {
				return {
					text: line,
					uri,
					lineNumber: startLine + i
				};
			});
	}

	private onResult(match: TextSearchResult): void {
		this.emit('result', match);
	}
}

function bytesOrTextToString(obj: any): string {
	return obj.bytes ?
		Buffer.from(obj.bytes, 'base64').toString() :
		obj.text;
}

function getNumLinesAndLastNewlineLength(text: string): { numLines: number, lastLineLength: number } {
	const re = /\n/g;
	let numLines = 0;
	let lastNewlineIdx = -1;
	let match: ReturnType<typeof re.exec>;
	while (match = re.exec(text)) {
		numLines++;
		lastNewlineIdx = match.index;
	}

	const lastLineLength = lastNewlineIdx >= 0 ?
		text.length - lastNewlineIdx - 1 :
		text.length;

	return { numLines, lastLineLength };
}

function getRgArgs(query: TextSearchQuery, options: TextSearchOptions): string[] {
	const args = ['--hidden'];
	args.push(query.isCaseSensitive ? '--case-sensitive' : '--ignore-case');

	const { doubleStarIncludes, otherIncludes } = groupBy(
		options.includes,
		(include: string) => startsWith(include, '**') ? 'doubleStarIncludes' : 'otherIncludes');

	if (otherIncludes && otherIncludes.length) {
		const uniqueOthers = new Set<string>();
		otherIncludes.forEach(other => {
			if (!endsWith(other, '/**')) {
				other += '/**';
			}

			uniqueOthers.add(other);
		});

		args.push('-g', '!*');
		uniqueOthers
			.forEach(otherIncude => {
				spreadGlobComponents(otherIncude)
					.map(anchorGlob)
					.forEach(globArg => {
						args.push('-g', globArg);
					});
			});
	}

	if (doubleStarIncludes && doubleStarIncludes.length) {
		doubleStarIncludes.forEach(globArg => {
			args.push('-g', globArg);
		});
	}

	options.excludes
		.map(anchorGlob)
		.forEach(rgGlob => args.push('-g', `!${rgGlob}`));

	if (options.maxFileSize) {
		args.push('--max-filesize', options.maxFileSize + '');
	}

	if (options.useIgnoreFiles) {
		args.push('--no-ignore-parent');
	} else {
		// Don't use .gitignore or .ignore
		args.push('--no-ignore');
	}

	if (options.followSymlinks) {
		args.push('--follow');
	}

	if (options.encoding && options.encoding !== 'utf8') {
		args.push('--encoding', options.encoding);
	}

	// Ripgrep handles -- as a -- arg separator. Only --.
	// - is ok, --- is ok, --some-flag is also ok. Need to special case.
	if (query.pattern === '--') {
		query.isRegExp = true;
		query.pattern = '\\-\\-';
	}

	if (query.isMultiline && !query.isRegExp) {
		query.pattern = escapeRegExpCharacters(query.pattern);
		query.isRegExp = true;
	}

	if ((<IExtendedExtensionSearchOptions>options).usePCRE2) {
		args.push('--pcre2');
	}

	if (query.isRegExp) {
		query.pattern = unicodeEscapesToPCRE2(query.pattern);
	}

	// Allow $ to match /r/n
	args.push('--crlf');

	let searchPatternAfterDoubleDashes: Maybe<string>;
	if (query.isWordMatch) {
		const regexp = createRegExp(query.pattern, !!query.isRegExp, { wholeWord: query.isWordMatch });
		const regexpStr = regexp.source.replace(/\\\//g, '/'); // RegExp.source arbitrarily returns escaped slashes. Search and destroy.
		args.push('--regexp', regexpStr);
	} else if (query.isRegExp) {
		let fixedRegexpQuery = fixRegexNewline(query.pattern);
		fixedRegexpQuery = fixNewline(fixedRegexpQuery);
		args.push('--regexp', fixedRegexpQuery);
		args.push('--auto-hybrid-regex');
	} else {
		searchPatternAfterDoubleDashes = query.pattern;
		args.push('--fixed-strings');
	}

	args.push('--no-config');
	if (!options.useGlobalIgnoreFiles) {
		args.push('--no-ignore-global');
	}

	args.push('--json');

	if (query.isMultiline) {
		args.push('--multiline');
	}

	if (options.beforeContext) {
		args.push('--before-context', options.beforeContext + '');
	}

	if (options.afterContext) {
		args.push('--after-context', options.afterContext + '');
	}

	// Folder to search
	args.push('--');

	if (searchPatternAfterDoubleDashes) {
		// Put the query after --, in case the query starts with a dash
		args.push(searchPatternAfterDoubleDashes);
	}

	args.push('.');

	return args;
}

/**
 * `"foo/*bar/something"` -> `["foo", "foo/*bar", "foo/*bar/something", "foo/*bar/something/**"]`
 */
export function spreadGlobComponents(globArg: string): string[] {
	const components = splitGlobAware(globArg, '/');
	if (components[components.length - 1] !== '**') {
		components.push('**');
	}

	return components.map((_, i) => components.slice(0, i + 1).join('/'));
}

export function unicodeEscapesToPCRE2(pattern: string): string {
	// Match \u1234
	const unicodePattern = /((?:[^\\]|^)(?:\\\\)*)\\u([a-z0-9]{4})/g;

	while (pattern.match(unicodePattern)) {
		pattern = pattern.replace(unicodePattern, `$1\\x{$2}`);
	}

	// Match \u{1234}
	// \u with 5-6 characters will be left alone because \x only takes 4 characters.
	const unicodePatternWithBraces = /((?:[^\\]|^)(?:\\\\)*)\\u\{([a-z0-9]{4})\}/g;
	while (pattern.match(unicodePatternWithBraces)) {
		pattern = pattern.replace(unicodePatternWithBraces, `$1\\x{$2}`);
	}

	return pattern;
}

export interface IRgMessage {
	type: 'match' | 'context' | string;
	data: IRgMatch;
}

export interface IRgMatch {
	path: IRgBytesOrText;
	lines: IRgBytesOrText;
	line_number: number;
	absolute_offset: number;
	submatches: IRgSubmatch[];
}

export interface IRgSubmatch {
	match: IRgBytesOrText;
	start: number;
	end: number;
}

export type IRgBytesOrText = { bytes: string } | { text: string };

export function fixRegexNewline(pattern: string): string {
	// Replace an unescaped $ at the end of the pattern with \r?$
	// Match $ preceeded by none or even number of literal \
	return pattern.replace(/([^\\]|^)(\\\\)*\\n/g, '$1$2\\r?\\n');
}

export function fixNewline(pattern: string): string {
	return pattern.replace(/\n/g, '\\r?\\n');
}
