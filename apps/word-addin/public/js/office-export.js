/**
 * Office.js glue: getting the open document out of Word as a PDF and as text.
 *
 * The Common API (`Office.context.document.getFileAsync`) is used rather than
 * the Word-specific API because it is the only one that will hand back a
 * rendered PDF of the document as it will actually print.
 */

/** 1 MB slices: large enough to keep round-trips down, small enough to be safe. */
const DEFAULT_SLICE_SIZE = 1024 * 1024;

export class ExportError extends Error {
  constructor(message, { code = null, hint = null } = {}) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
    this.hint = hint;
  }
}

export function officeReady() {
  return new Promise((resolve) => {
    Office.onReady((info) => resolve(info));
  });
}

function getFile(fileType, sliceSize) {
  return new Promise((resolve, reject) => {
    Office.context.document.getFileAsync(fileType, { sliceSize }, (result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        resolve(result.value);
        return;
      }
      const error = result.error ?? {};
      reject(
        new ExportError(error.message || 'Word could not export the document.', {
          code: error.code ?? null,
          hint:
            fileType === Office.FileType.Pdf
              ? 'Word on the web cannot export PDFs from an add-in. Open the document in the Word desktop app and try again.'
              : null,
        }),
      );
    });
  });
}

function getSlice(file, index) {
  return new Promise((resolve, reject) => {
    file.getSliceAsync(index, (result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value);
      else reject(new ExportError(result.error?.message || `Could not read part ${index + 1} of the document.`));
    });
  });
}

function closeFile(file) {
  try {
    file.closeAsync(() => {});
  } catch {
    /* the document handle is released when the pane closes anyway */
  }
}

async function readAllSlices(file) {
  const parts = [];
  for (let index = 0; index < file.sliceCount; index += 1) {
    const slice = await getSlice(file, index);
    parts.push(slice.data);
  }
  return parts;
}

/**
 * Export the open document as a PDF.
 *
 * @returns {Promise<{blob: Blob, byteLength: number}>}
 */
export async function exportDocumentPdf({ sliceSize = DEFAULT_SLICE_SIZE } = {}) {
  const file = await getFile(Office.FileType.Pdf, sliceSize);
  try {
    const parts = await readAllSlices(file);
    // Slice data arrives as arrays of byte values on every current host.
    const chunks = parts.map((part) => (part instanceof Uint8Array ? part : new Uint8Array(part)));
    const byteLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
    if (byteLength === 0) {
      throw new ExportError('Word returned an empty PDF. Save the document and try again.');
    }
    return { blob: new Blob(chunks, { type: 'application/pdf' }), byteLength };
  } finally {
    closeFile(file);
  }
}

/** Read the document body as plain text, for auto-extraction. */
export async function readDocumentText() {
  if (typeof Word !== 'undefined' && typeof Word.run === 'function') {
    return Word.run(async (context) => {
      const body = context.document.body;
      body.load('text');
      await context.sync();
      return body.text ?? '';
    });
  }

  const file = await getFile(Office.FileType.Text, DEFAULT_SLICE_SIZE);
  try {
    const parts = await readAllSlices(file);
    return parts.map((part) => (typeof part === 'string' ? part : new TextDecoder().decode(new Uint8Array(part)))).join('');
  } finally {
    closeFile(file);
  }
}

/** Best-effort file name for the exported PDF, e.g. "Smith demand letter.pdf". */
export function documentPdfName() {
  let base = 'letter';
  try {
    const url = Office.context.document.url ?? '';
    const raw = decodeURIComponent(url.split(/[?#]/)[0].split(/[\\/]/).pop() ?? '');
    const withoutExtension = raw.replace(/\.(docx?|dotx?|rtf|odt)$/i, '').trim();
    if (withoutExtension) base = withoutExtension;
  } catch {
    /* url is unavailable for unsaved documents */
  }
  return `${base.slice(0, 100)}.pdf`;
}

/** True when the host is Word on the web, where PDF export is unavailable. */
export function isWordOnTheWeb() {
  return Office.context?.platform === Office.PlatformType.OfficeOnline;
}
