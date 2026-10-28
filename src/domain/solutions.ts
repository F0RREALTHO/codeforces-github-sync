import type { CfSubmission } from './types';

export function problemKey(problem: CfSubmission['problem']): string {
  return `${problem.contestId ?? 'gym'}-${problem.index}`;
}

export function acceptedLatest(submissions: CfSubmission[]): CfSubmission[] {
  const latest = new Map<string, CfSubmission>();
  for (const submission of submissions) {
    if (submission.verdict !== 'OK') continue;
    const key = problemKey(submission.problem);
    const prior = latest.get(key);
    if (!prior || submission.id > prior.id) latest.set(key, submission);
  }
  return [...latest.values()].sort((a, b) => a.id - b.id);
}

export function fileExtension(language: string): string {
  const normalized = language.toLowerCase();
  if (/java/.test(normalized)) return 'java';
  if (/kotlin/.test(normalized)) return 'kt';
  if (/python/.test(normalized)) return 'py';
  if (/rust/.test(normalized)) return 'rs';
  if (/go\s|golang/.test(normalized)) return 'go';
  if (/javascript|node\.js/.test(normalized)) return 'js';
  if (/typescript/.test(normalized)) return 'ts';
  if (/c#|csharp/.test(normalized)) return 'cs';
  if (/pascal/.test(normalized)) return 'pas';
  if (/ruby/.test(normalized)) return 'rb';
  if (/php/.test(normalized)) return 'php';
  if (/swift/.test(normalized)) return 'swift';
  if (/haskell/.test(normalized)) return 'hs';
  if (/scala/.test(normalized)) return 'scala';
  if (/c\+\+|cpp/.test(normalized)) return 'cpp';
  if (/^c(\s|$)| gcc|gnu c/.test(normalized)) return 'c';
  return 'txt';
}

export function sanitizeSegment(value: string): string {
  const clean = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '').slice(0, 80);
  return clean || 'solution';
}

export function problemFolderIndex(submission: CfSubmission): string {
  const contest = submission.problem.contestId ?? submission.contestId ?? 0;
  const rawIndex = (submission.problem.index || '').trim();
  if (contest > 0 && !rawIndex.toLowerCase().startsWith(String(contest).toLowerCase())) {
    return `${contest}${rawIndex}`;
  }
  return rawIndex || 'problem';
}

export function solutionPath(submission: CfSubmission): string {
  const rating = submission.problem.rating ? String(submission.problem.rating) : 'Unrated';
  const cleanIndex = sanitizeSegment(problemFolderIndex(submission));
  const cleanName = sanitizeSegment(submission.problem.name);
  const folderName = `${cleanIndex}_${cleanName}`;
  const ext = fileExtension(submission.programmingLanguage);
  return `Codeforces/${rating}/${folderName}/${submission.id}.${ext}`;
}

export function legacySolutionPath(submission: CfSubmission): string {
  const contest = submission.problem.contestId ?? submission.contestId ?? 0;
  const index = sanitizeSegment(submission.problem.index);
  const name = sanitizeSegment(submission.problem.name);
  return `Codeforces/${contest}/${index}_${name}.${fileExtension(submission.programmingLanguage)}`;
}

export function solutionMetadata(submission: CfSubmission): string {
  const p = submission.problem;
  return [
    `// Codeforces: https://codeforces.com/contest/${p.contestId ?? submission.contestId}/${encodeURIComponent(p.index)}`,
    `// Problem: ${p.name}`,
    `// Submission: https://codeforces.com/contest/${submission.contestId ?? p.contestId}/submission/${submission.id}`,
    `// Language: ${submission.programmingLanguage}`,
    `// Submitted: ${new Date(submission.creationTimeSeconds * 1000).toISOString()}`,
    ...(p.rating ? [`// Rating: ${p.rating}`] : []),
  ].join('\n');
}

export function solutionContent(submission: CfSubmission, source: string): { path: string; content: string; metadataFile?: { path: string; content: string } } {
  const path = solutionPath(submission);
  const ext = fileExtension(submission.programmingLanguage);
  const metadata = solutionMetadata(submission);
  const lineComment = ['cpp', 'c', 'java', 'kt', 'rs', 'go', 'js', 'ts', 'cs', 'swift', 'php'].includes(ext) ? '//'
    : ['py', 'rb', 'pl', 'sh'].includes(ext) ? '#'
    : ext === 'hs' ? '--' : undefined;
  const cleanSource = source.replace(/^\uFEFF/, '');
  if (!lineComment) return { path, content: cleanSource, metadataFile: { path: `${path}.metadata.json`, content: `${JSON.stringify({ problem: submission.problem.name, contestId: submission.problem.contestId ?? submission.contestId, index: submission.problem.index, problemUrl: `https://codeforces.com/contest/${submission.problem.contestId ?? submission.contestId}/problem/${submission.problem.index}`, submissionId: submission.id, programmingLanguage: submission.programmingLanguage, submittedAt: new Date(submission.creationTimeSeconds * 1000).toISOString(), rating: submission.problem.rating }, null, 2)}\n` } };
  const comments = metadata.split('\n').map((line) => `${lineComment} ${line.replace(/^\/\/\s?/, '')}`).join('\n');
  if (ext === 'php' && cleanSource.startsWith('<?php')) return { path, content: cleanSource.replace('<?php', `<?php\n${comments}`) };
  if (ext === 'py' && cleanSource.startsWith('#!')) {
    const eol = cleanSource.indexOf('\n');
    if (eol >= 0) return { path, content: `${cleanSource.slice(0, eol + 1)}${comments}\n${cleanSource.slice(eol + 1)}` };
  }
  return { path, content: `${comments}\n${cleanSource}` };
}
