/**
 * JS side of the app-local NativeDocument plugin
 * (android/app/src/main/java/online/stockbolt/app/NativeDocumentPlugin.java).
 * Only call these when isNative() is true.
 */
import { registerPlugin } from '@capacitor/core';

interface NativeDocumentPlugin {
  print(options: { jobName: string }): Promise<void>;
  sharePdf(options: { fileName: string; title?: string }): Promise<{ fileName: string }>;
  shareFile(options: { fileName: string; base64: string; mimeType: string; title?: string }): Promise<{ fileName: string }>;
}

const NativeDocument = registerPlugin<NativeDocumentPlugin>('NativeDocument');

/** Opens Android's print dialog for the current screen (printers + "Save as PDF"). */
export function printCurrentPage(): Promise<void> {
  return NativeDocument.print({ jobName: document.title || 'StockBolt' });
}

/**
 * Renders the current screen to a PDF and opens the share sheet (WhatsApp,
 * email, Drive…). Falls back to the print dialog on devices that cannot
 * export directly — "Save as PDF" is available there.
 */
export async function shareCurrentPageAsPdf(fileName: string): Promise<void> {
  try {
    await NativeDocument.sharePdf({ fileName, title: 'Share PDF' });
  } catch {
    await printCurrentPage();
  }
}

/** Saves a generated file to the app cache and opens the share sheet for it. */
export async function shareBlob(blob: Blob, fileName: string): Promise<void> {
  const base64 = await blobToBase64(blob);
  await NativeDocument.shareFile({ fileName, base64, mimeType: blob.type || 'application/octet-stream', title: 'Save or share' });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
