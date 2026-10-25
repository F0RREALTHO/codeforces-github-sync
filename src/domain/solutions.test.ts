import { describe, expect, it } from 'vitest';
import type { CfSubmission } from './types';
import { acceptedLatest, fileExtension, problemKey, sanitizeSegment, solutionContent, solutionPath } from './solutions';

const submission = (id: number, verdict: string, language = 'GNU C++20 (64)', index = 'A', name = 'A+B Problem'): CfSubmission => ({ id, contestId: 1000, creationTimeSeconds: id, verdict, programmingLanguage: language, problem: { contestId: 1000, index, name, rating: 800 } });

describe('solution selection and paths', () => {
  it('keeps only the newest Accepted submission per problem', () => {
    const result = acceptedLatest([submission(10, 'OK'), submission(11, 'WRONG_ANSWER'), submission(12, 'OK'), submission(20, 'OK', 'PyPy 3', 'B')]);
    expect(result.map((item) => item.id)).toEqual([12, 20]);
  });
  it('does not confuse problem indexes or contest IDs', () => {
    expect(problemKey(submission(1, 'OK').problem)).toBe('1000-A');
    expect(acceptedLatest([submission(1, 'OK'), { ...submission(2, 'OK'), problem: { ...submission(2, 'OK').problem, contestId: 1001 } }])).toHaveLength(2);
  });
  it('maps common Codeforces languages and keeps unknown extensions safe', () => {
    expect(fileExtension('GNU C++20')).toBe('cpp');
    expect(fileExtension('Python 3.11')).toBe('py');
    expect(fileExtension('Java 21')).toBe('java');
    expect(fileExtension('Rust 1.80')).toBe('rs');
    expect(fileExtension('unrecognized')).toBe('txt');
  });
  it('sanitizes filenames and groups by contest', () => {
    const item = submission(8, 'OK', 'GNU C++20', 'A*', '../bad name?');
    expect(sanitizeSegment('../bad name?')).toBe('bad_name');
    expect(solutionPath(item)).toBe('Codeforces/1000/A_bad_name.cpp');
  });
  it('uses valid Python comments without changing the program body', () => {
    const item = submission(10, 'OK', 'Python 3');
    const result = solutionContent(item, '#!/usr/bin/env python3\nprint("ok")');
    expect(result.content.startsWith('#!/usr/bin/env python3\n# Codeforces:')).toBe(true);
    expect(result.content).toContain('print("ok")');
  });
  it('writes metadata sidecars for unknown languages rather than corrupting source', () => {
    const result = solutionContent(submission(4, 'OK', 'Unknown runtime'), 'raw source');
    expect(result.content).toBe('raw source');
    expect(result.metadataFile?.path).toContain('.metadata.json');
    expect(JSON.parse(result.metadataFile!.content).submissionId).toBe(4);
  });
});
