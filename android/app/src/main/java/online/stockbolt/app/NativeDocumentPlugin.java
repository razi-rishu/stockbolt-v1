package online.stockbolt.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.print.PdfExporter;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * Print, PDF and file sharing for the StockBolt Android app — the things
 * window.print() and <a download> cannot do inside an Android WebView.
 *
 *   print({ jobName })                       system print dialog (printers + "Save as PDF")
 *   sharePdf({ fileName, title })            current page → PDF → share sheet (WhatsApp, email…)
 *   shareFile({ fileName, base64, mimeType }) any generated file (CSV, XLSX…) → share sheet
 */
@CapacitorPlugin(name = "NativeDocument")
public class NativeDocumentPlugin extends Plugin {

    private static final String SHARE_DIR = "shared";

    @PluginMethod
    public void print(final PluginCall call) {
        final String jobName = call.getString("jobName", "StockBolt");
        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = getBridge().getWebView();
                PrintManager printManager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
                printManager.print(jobName, adapter, new PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    .build());
                call.resolve();
            } catch (Exception e) {
                call.reject("Printing is not available: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void sharePdf(final PluginCall call) {
        final String fileName = safeFileName(call.getString("fileName", "document.pdf"), ".pdf");
        final String title = call.getString("title", "Share PDF");
        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = getBridge().getWebView();
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(fileName);
                PrintAttributes attributes = new PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 600, 600))
                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                    .build();
                File out = new File(shareDir(), fileName);
                PdfExporter.export(adapter, attributes, out, new PdfExporter.Callback() {
                    @Override
                    public void onDone(File file) {
                        getActivity().runOnUiThread(() -> share(call, file, "application/pdf", title));
                    }

                    @Override
                    public void onError(String message) {
                        call.reject(message);
                    }
                });
            } catch (Throwable t) {
                // Older/unusual WebViews: the caller falls back to the print dialog.
                call.reject("PDF export is not supported on this device: " + t.getMessage());
            }
        });
    }

    @PluginMethod
    public void shareFile(final PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null) {
            call.reject("base64 is required");
            return;
        }
        String fileName = safeFileName(call.getString("fileName", "export"), "");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String title = call.getString("title", "Save or share");
        try {
            File out = new File(shareDir(), fileName);
            try (FileOutputStream stream = new FileOutputStream(out)) {
                stream.write(Base64.decode(base64, Base64.DEFAULT));
            }
            getActivity().runOnUiThread(() -> share(call, out, mimeType, title));
        } catch (IOException | IllegalArgumentException e) {
            call.reject("Could not save the file: " + e.getMessage());
        }
    }

    private void share(PluginCall call, File file, String mimeType, String title) {
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mimeType);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, file.getName());
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            JSObject result = new JSObject();
            result.put("fileName", file.getName());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not open the share sheet: " + e.getMessage());
        }
    }

    /** Cache sub-folder exposed through the app's FileProvider (cache-path "."). */
    private File shareDir() {
        File dir = new File(getContext().getCacheDir(), SHARE_DIR);
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private static String safeFileName(String name, String requiredExt) {
        String cleaned = name.replaceAll("[\\\\/:*?\"<>|\\s]+", "-");
        if (cleaned.isEmpty()) cleaned = "document";
        if (!requiredExt.isEmpty() && !cleaned.toLowerCase().endsWith(requiredExt)) cleaned += requiredExt;
        return cleaned;
    }
}
