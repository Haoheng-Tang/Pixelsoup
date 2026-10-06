/**
 * How the app reads and writes files. The rest of the app uses only this interface and
 * never knows which implementation is active:
 *
 * - `FileSystemAccessStore` (Chromium): native open/save pickers, and Save writes back to
 *   the same file through its handle.
 * - `DownloadFileStore` (elsewhere): `<input type="file">` to open, and every save
 *   downloads a new copy.
 */
export interface FileStore {
  /** True if saving to a `FileRef` overwrites that file; false if every save downloads. */
  readonly savesInPlace: boolean;
  /** Lets the user pick one file. Resolves to null if they cancel. */
  open(types: readonly FileType[]): Promise<OpenedFile | null>;
  /** Writes a file. Resolves to where it went, or null if the user cancelled. */
  save(request: SaveRequest): Promise<FileRef | null>;
}

/** A file the store can write to again. Opaque apart from its name. */
export interface FileRef {
  readonly name: string;
}

export interface FileType {
  readonly description: string;
  /** MIME type → file extensions including the dot, e.g. `{ 'image/png': ['.png'] }`. */
  readonly accept: Readonly<Record<string, readonly string[]>>;
}

export interface OpenedFile {
  readonly file: File;
  /** Where Save could write this file back, or null if the store can't. */
  readonly ref: FileRef | null;
}

export interface SaveRequest {
  /** Overwrite this file without asking, if the store can; otherwise ask where to save. */
  readonly target?: FileRef | null;
  readonly suggestedName: string;
  readonly type: FileType;
  /**
   * Produces the contents. Called only after the destination is chosen, so pickers open
   * while the triggering click or key press still counts as user activation.
   */
  readonly data: () => Promise<Blob>;
}

export function createFileStore(): FileStore {
  const pickers = filePickers();
  return pickers ? new FileSystemAccessStore(pickers) : new DownloadFileStore();
}

// The pickers and handle permission methods aren't in TypeScript's DOM library yet.
interface FilePickerAcceptType {
  description: string;
  accept: Record<string, string[]>;
}
interface FilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}
interface FilePickers {
  showOpenFilePicker(
    options?: FilePickerOptions & { multiple?: false },
  ): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(
    options?: FilePickerOptions & { suggestedName?: string },
  ): Promise<FileSystemFileHandle>;
}
interface PermissionDescriptor {
  mode: 'read' | 'readwrite';
}
interface HandlePermissions {
  queryPermission?(descriptor: PermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor: PermissionDescriptor): Promise<PermissionState>;
}

function filePickers(): FilePickers | null {
  const candidate = window as Partial<FilePickers>;
  const { showOpenFilePicker, showSaveFilePicker } = candidate;
  // Cross-origin frames may not show pickers; fall back to downloads there.
  if (!showOpenFilePicker || !showSaveFilePicker || window.self !== window.top) return null;
  return {
    showOpenFilePicker: showOpenFilePicker.bind(window),
    showSaveFilePicker: showSaveFilePicker.bind(window),
  };
}

function pickerTypes(types: readonly FileType[]): FilePickerAcceptType[] {
  return types.map(({ description, accept }) => ({
    description,
    accept: Object.fromEntries(
      Object.entries(accept).map(([mime, extensions]) => [mime, [...extensions]]),
    ),
  }));
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

class HandleRef implements FileRef {
  constructor(readonly handle: FileSystemFileHandle) {}

  get name(): string {
    return this.handle.name;
  }
}

class FileSystemAccessStore implements FileStore {
  readonly savesInPlace = true;

  constructor(private readonly pickers: FilePickers) {}

  async open(types: readonly FileType[]): Promise<OpenedFile | null> {
    let handles: FileSystemFileHandle[];
    try {
      handles = await this.pickers.showOpenFilePicker({ types: pickerTypes(types) });
    } catch (error) {
      if (isAbort(error)) return null;
      throw error;
    }
    const [handle] = handles;
    if (!handle) return null;
    return { file: await handle.getFile(), ref: new HandleRef(handle) };
  }

  async save({ target, suggestedName, type, data }: SaveRequest): Promise<FileRef | null> {
    let handle = target instanceof HandleRef ? target.handle : null;
    // A handle from the open picker is read-only until the user allows writing.
    if (handle && !(await canWrite(handle))) return null;
    if (!handle) {
      try {
        handle = await this.pickers.showSaveFilePicker({
          suggestedName,
          types: pickerTypes([type]),
        });
      } catch (error) {
        if (isAbort(error)) return null;
        throw error;
      }
    }
    const contents = await data();
    // The browser writes to a temporary file and only replaces the target on close().
    const writable = await handle.createWritable();
    try {
      await writable.write(contents);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
    return new HandleRef(handle);
  }
}

async function canWrite(handle: FileSystemFileHandle): Promise<boolean> {
  const permissions = handle as FileSystemFileHandle & HandlePermissions;
  const descriptor: PermissionDescriptor = { mode: 'readwrite' };
  if (!permissions.queryPermission || !permissions.requestPermission) return true;
  if ((await permissions.queryPermission(descriptor)) === 'granted') return true;
  return (await permissions.requestPermission(descriptor)) === 'granted';
}

class DownloadFileStore implements FileStore {
  readonly savesInPlace = false;

  open(types: readonly FileType[]): Promise<OpenedFile | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = types
        .flatMap(({ accept }) => Object.entries(accept).flat(2))
        .filter((value, index, all) => all.indexOf(value) === index)
        .join(',');
      input.hidden = true;
      const finish = (file: File | null) => {
        input.remove();
        resolve(file ? { file, ref: null } : null);
      };
      input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
      input.addEventListener('cancel', () => finish(null), { once: true });
      document.body.append(input);
      input.click();
    });
  }

  async save({ suggestedName, data }: SaveRequest): Promise<FileRef> {
    const url = URL.createObjectURL(await data());
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    // The download reads the blob asynchronously; release it once that has had time.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { name: suggestedName };
  }
}
