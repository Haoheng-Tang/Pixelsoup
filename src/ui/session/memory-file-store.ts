import type { FileRef, FileStore, FileType, OpenedFile, SaveRequest } from '../io/file-store';

/**
 * In-memory FileStore for tests. `pick` is what the next open picker returns, and
 * `saveName` what the next save picker returns (null = the user cancels).
 */
export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, Blob>();
  pick: File | null = null;
  saveName: string | null = 'picked.soup';
  openPickers: (readonly FileType[])[] = [];
  savePickers: SaveRequest[] = [];
  /** Runs inside `save` after the data is produced, to simulate work during a save. */
  afterData: (() => void) | null = null;

  constructor(readonly savesInPlace = true) {}

  open(types: readonly FileType[]): Promise<OpenedFile | null> {
    this.openPickers.push(types);
    const file = this.pick;
    return Promise.resolve(file ? { file, ref: { name: file.name } } : null);
  }

  async save(request: SaveRequest): Promise<FileRef | null> {
    let name = this.savesInPlace ? request.target?.name : undefined;
    if (!name) {
      this.savePickers.push(request);
      name = this.savesInPlace ? (this.saveName ?? undefined) : request.suggestedName;
      if (!name) return null;
    }
    const data = await request.data();
    this.afterData?.();
    this.files.set(name, data);
    return { name };
  }

  /** A previously saved file, as the open picker would return it. */
  file(name: string): File {
    const blob = this.files.get(name);
    if (!blob) throw new Error(`No file ${name}`);
    return new File([blob], name);
  }
}
