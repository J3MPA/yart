import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildLineMapFromGit,
  findRepoRoot,
  GitError,
  lineMapFromHunks,
  listChangedFiles,
  parseHunkHeaders,
  readBlob,
  resolveRev,
} from './git.ts';
import { TestRepo } from './test-repo.ts';

const FOUR_LINES = 'alpha\nbeta\ngamma\ndelta\n';

let repo: TestRepo;

beforeEach(() => {
  repo = new TestRepo();
});

afterEach(() => {
  repo.dispose();
});

describe('parseHunkHeaders', () => {
  it('reads a header with explicit counts', () => {
    expect(parseHunkHeaders('@@ -3,2 +3,5 @@ context')).toEqual([
      { old_start: 3, old_count: 2, new_start: 3, new_count: 5 },
    ]);
  });

  it('treats an omitted count as one', () => {
    expect(parseHunkHeaders('@@ -7 +9 @@')).toEqual([
      { old_start: 7, old_count: 1, new_start: 9, new_count: 1 },
    ]);
  });

  it('ignores everything that is not a header', () => {
    expect(parseHunkHeaders('diff --git a/x b/x\n--- a/x\n+++ b/x\n+added\n')).toEqual([]);
  });
});

describe('lineMapFromHunks', () => {
  it('maps every line when nothing changed', () => {
    expect([...lineMapFromHunks([], 3)]).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it('carries the anchor line of a pure insertion, which has a zero old count', () => {
    // "insert one line after old line 2"
    const map = lineMapFromHunks([{ old_start: 2, old_count: 0, new_start: 3, new_count: 1 }], 3);
    expect(map.get(2)).toBe(2);
    expect(map.get(3)).toBe(4);
  });

  it('carries the anchor line of a pure deletion, which has a zero new count', () => {
    // "delete old line 2"
    const map = lineMapFromHunks([{ old_start: 2, old_count: 1, new_start: 1, new_count: 0 }], 3);
    expect(map.get(1)).toBe(1);
    expect(map.has(2)).toBe(false);
    expect(map.get(3)).toBe(2);
  });
});

describe('against a real repository', () => {
  it('resolves a revision to a full sha', async () => {
    repo.write('a.txt', FOUR_LINES);
    const sha = repo.commit('first');
    await expect(resolveRev(repo.path, 'HEAD')).resolves.toBe(sha);
  });

  it('reports a useful error for an unknown revision', async () => {
    repo.write('a.txt', FOUR_LINES);
    repo.commit('first');
    await expect(resolveRev(repo.path, 'no-such-rev')).rejects.toBeInstanceOf(GitError);
  });

  it('finds the repository root', async () => {
    repo.write('nested/deep/a.txt', 'x\n');
    repo.commit('first');
    const root = await findRepoRoot(repo.path);
    expect(root.endsWith(repo.path.replace('/private', ''))).toBe(true);
  });

  it('reads a blob by hash', async () => {
    repo.write('a.txt', FOUR_LINES);
    repo.commit('first');
    const sha = repo.blobSha('HEAD', 'a.txt');
    await expect(readBlob(repo.path, sha)).resolves.toBe(FOUR_LINES);
  });

  describe('listChangedFiles', () => {
    it('reports a modified file with both blobs', async () => {
      repo.write('a.txt', FOUR_LINES);
      const base = repo.commit('first');
      repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n');
      const head = repo.commit('second');

      const [file] = await listChangedFiles(repo.path, base, head);
      expect(file).toMatchObject({ status: 'modified', path: 'a.txt', old_path: null });
      expect(file?.base_blob_sha).toBe(repo.blobSha(base, 'a.txt'));
      expect(file?.head_blob_sha).toBe(repo.blobSha(head, 'a.txt'));
    });

    it('reports an added file with no base blob', async () => {
      repo.write('a.txt', FOUR_LINES);
      const base = repo.commit('first');
      repo.write('b.txt', 'new\n');
      const head = repo.commit('second');

      const [file] = await listChangedFiles(repo.path, base, head);
      expect(file).toMatchObject({ status: 'added', path: 'b.txt', base_blob_sha: null });
      expect(file?.head_blob_sha).not.toBeNull();
    });

    it('reports a deleted file with no head blob', async () => {
      repo.write('a.txt', FOUR_LINES);
      repo.write('b.txt', 'gone\n');
      const base = repo.commit('first');
      repo.remove('b.txt');
      const head = repo.commit('second');

      const [file] = await listChangedFiles(repo.path, base, head);
      expect(file).toMatchObject({ status: 'deleted', path: 'b.txt', head_blob_sha: null });
    });

    it('detects a rename and reports both paths', async () => {
      repo.write('a.txt', FOUR_LINES);
      const base = repo.commit('first');
      repo.move('a.txt', 'renamed.txt');
      const head = repo.commit('second');

      const [file] = await listChangedFiles(repo.path, base, head);
      expect(file).toMatchObject({
        status: 'renamed',
        path: 'renamed.txt',
        old_path: 'a.txt',
      });
    });

    it('handles paths containing spaces', async () => {
      repo.write('with space.txt', 'x\n');
      const base = repo.commit('first');
      repo.write('with space.txt', 'y\n');
      const head = repo.commit('second');

      const [file] = await listChangedFiles(repo.path, base, head);
      expect(file?.path).toBe('with space.txt');
    });

    it('reports several files at once', async () => {
      repo.write('a.txt', 'a\n');
      repo.write('b.txt', 'b\n');
      const base = repo.commit('first');
      repo.write('a.txt', 'a2\n');
      repo.write('b.txt', 'b2\n');
      repo.write('c.txt', 'c\n');
      const head = repo.commit('second');

      const files = await listChangedFiles(repo.path, base, head);
      expect(files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
    });

    it('returns nothing when the revisions match', async () => {
      repo.write('a.txt', FOUR_LINES);
      const sha = repo.commit('first');
      await expect(listChangedFiles(repo.path, sha, sha)).resolves.toEqual([]);
    });
  });

  describe('buildLineMapFromGit', () => {
    const mapFor = async (before: string, after: string, ignore_whitespace?: boolean) => {
      repo.write('a.txt', before);
      const base = repo.commit('first');
      repo.write('a.txt', after);
      const head = repo.commit('second');
      return buildLineMapFromGit(
        repo.path,
        repo.blobSha(base, 'a.txt'),
        repo.blobSha(head, 'a.txt'),
        ignore_whitespace === undefined ? {} : { ignore_whitespace },
      );
    };

    it('shifts lines down past an insertion above them', async () => {
      const map = await mapFor(FOUR_LINES, 'inserted\nalpha\nbeta\ngamma\ndelta\n');
      expect(map.get(1)).toBe(2);
      expect(map.get(4)).toBe(5);
    });

    it('shifts lines up past a deletion above them', async () => {
      const map = await mapFor(FOUR_LINES, 'gamma\ndelta\n');
      expect(map.get(3)).toBe(1);
      expect(map.get(4)).toBe(2);
    });

    it('drops a rewritten line and keeps its neighbours', async () => {
      const map = await mapFor(FOUR_LINES, 'alpha\nREWRITTEN\ngamma\ndelta\n');
      expect(map.get(1)).toBe(1);
      expect(map.has(2)).toBe(false);
      expect(map.get(3)).toBe(3);
    });

    it('drops a deleted line and keeps its neighbours', async () => {
      const map = await mapFor(FOUR_LINES, 'alpha\ngamma\ndelta\n');
      expect(map.get(1)).toBe(1);
      expect(map.has(2)).toBe(false);
      expect(map.get(3)).toBe(2);
    });

    it('maps everything when a change is confined to the end', async () => {
      const map = await mapFor(FOUR_LINES, 'alpha\nbeta\ngamma\ndelta\nepsilon\n');
      expect(map.get(1)).toBe(1);
      expect(map.get(4)).toBe(4);
    });

    it('survives a reindent by default', async () => {
      const map = await mapFor('if (x) {\nf();\n}\n', 'if (x) {\n    f();\n}\n');
      expect(map.get(2)).toBe(2);
    });

    it('drops a reindented line when whitespace is significant', async () => {
      const map = await mapFor('if (x) {\nf();\n}\n', 'if (x) {\n    f();\n}\n', false);
      expect(map.has(2)).toBe(false);
    });

    it('maps nothing when the file is emptied', async () => {
      expect([...(await mapFor(FOUR_LINES, ''))]).toEqual([]);
    });

    it('handles a file without a trailing newline', async () => {
      const map = await mapFor('a\nb', 'a\nb\nc\n');
      expect(map.get(2)).toBe(2);
    });
  });
});
