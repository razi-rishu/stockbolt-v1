package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.IOException;

/**
 * Renders a WebView's PrintDocumentAdapter straight to a PDF file, without the
 * system print dialog. Lives in the android.print package because the
 * LayoutResultCallback / WriteResultCallback constructors are package-private
 * in the SDK stubs. Callers must treat any Throwable as "not supported on this
 * device" and fall back to the print dialog.
 */
public final class PdfExporter {

    public interface Callback {
        void onDone(File file);
        void onError(String message);
    }

    private PdfExporter() {}

    public static void export(final PrintDocumentAdapter adapter, final PrintAttributes attributes, final File out, final Callback callback) {
        adapter.onStart();
        adapter.onLayout(null, attributes, null, new PrintDocumentAdapter.LayoutResultCallback() {
            @Override
            public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                final ParcelFileDescriptor fd;
                try {
                    fd = ParcelFileDescriptor.open(out,
                        ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_READ_WRITE);
                } catch (IOException e) {
                    adapter.onFinish();
                    callback.onError("Could not create the PDF file: " + e.getMessage());
                    return;
                }
                adapter.onWrite(new PageRange[] { PageRange.ALL_PAGES }, fd, new CancellationSignal(), new PrintDocumentAdapter.WriteResultCallback() {
                    @Override
                    public void onWriteFinished(PageRange[] pages) {
                        close(fd);
                        adapter.onFinish();
                        callback.onDone(out);
                    }

                    @Override
                    public void onWriteFailed(CharSequence error) {
                        close(fd);
                        adapter.onFinish();
                        callback.onError("PDF write failed: " + error);
                    }

                    @Override
                    public void onWriteCancelled() {
                        close(fd);
                        adapter.onFinish();
                        callback.onError("PDF write cancelled");
                    }
                });
            }

            @Override
            public void onLayoutFailed(CharSequence error) {
                adapter.onFinish();
                callback.onError("PDF layout failed: " + error);
            }
        }, null);
    }

    private static void close(ParcelFileDescriptor fd) {
        try {
            fd.close();
        } catch (IOException ignored) {
            // Nothing useful to do; the file is already written or abandoned.
        }
    }
}
