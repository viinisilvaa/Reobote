// REOBOTE | aplicativo-android/nativo/MockLocationPlugin.java — APK: detecta GPS falso (localização simulada) no Android
package br.com.reobote.app;

import android.app.AppOpsManager;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;

/**
 * Plugin nativo do REOBOTE que responde à pergunta: "este celular está com GPS falso?".
 *
 * Apps de GPS falso (sem root) só funcionam se forem escolhidos como "app de local fictício" nas
 * opções do desenvolvedor do Android. Este plugin confere duas coisas:
 *  1. se algum app instalado está AUTORIZADO a simular localização (permissão ACCESS_MOCK_LOCATION
 *     liberada pelo Android em AppOpsManager) — é o app escolhido nas opções do desenvolvedor;
 *  2. se a última posição conhecida do GPS, da rede ou do provedor combinado veio marcada como simulada.
 *
 * No JavaScript: window.Capacitor.registerPlugin("MockLocation").check()
 *   -> { mock: true/false, mockApps: ["Nome do app", ...], lastLocationMock: true/false }
 *
 * Copiado para o projeto Android e registrado no MainActivity pelo script scripts/configurar-android.mjs.
 */
@CapacitorPlugin(name = "MockLocation")
public class MockLocationPlugin extends Plugin {

    @PluginMethod
    public void check(PluginCall call) {
        Context context = getContext();
        JSArray mockApps = new JSArray();
        boolean lastLocationMock = false;

        // 1. Apps autorizados a simular localização.
        try {
            PackageManager packageManager = context.getPackageManager();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                AppOpsManager appOps = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
                List<PackageInfo> packages = packageManager.getInstalledPackages(PackageManager.GET_PERMISSIONS);
                for (PackageInfo info : packages) {
                    if (info.requestedPermissions == null || info.applicationInfo == null || context.getPackageName().equals(info.packageName)) {
                        continue;
                    }
                    boolean wantsMock = false;
                    for (String permission : info.requestedPermissions) {
                        if ("android.permission.ACCESS_MOCK_LOCATION".equals(permission)) {
                            wantsMock = true;
                            break;
                        }
                    }
                    if (!wantsMock) {
                        continue;
                    }
                    int mode = appOps.checkOpNoThrow(AppOpsManager.OPSTR_MOCK_LOCATION, info.applicationInfo.uid, info.packageName);
                    if (mode == AppOpsManager.MODE_ALLOWED) {
                        mockApps.put(packageManager.getApplicationLabel(info.applicationInfo).toString());
                    }
                }
            } else if (!"0".equals(Settings.Secure.getString(context.getContentResolver(), "mock_location"))) {
                // Android 5 (antigo): uma única chave "permitir locais fictícios".
                mockApps.put("Locais fictícios permitidos");
            }
        } catch (Exception ignored) {
            // Sem acesso à lista de apps: segue só com a checagem da última posição.
        }

        // 2. Última posição conhecida marcada como simulada.
        try {
            LocationManager locationManager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            for (String provider : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, "fused" }) {
                try {
                    Location location = locationManager.getLastKnownLocation(provider);
                    if (location != null && isMock(location)) {
                        lastLocationMock = true;
                    }
                } catch (SecurityException | IllegalArgumentException ignored) {
                    // Provedor inexistente neste aparelho ou permissão de localização ainda não concedida.
                }
            }
        } catch (Exception ignored) {
            // Sem serviço de localização.
        }

        JSObject result = new JSObject();
        result.put("mock", mockApps.length() > 0 || lastLocationMock);
        result.put("mockApps", mockApps);
        result.put("lastLocationMock", lastLocationMock);
        call.resolve(result);
    }

    // Android 12+ usa isMock(); versões anteriores, isFromMockProvider().
    @SuppressWarnings("deprecation")
    private boolean isMock(Location location) {
        if (Build.VERSION.SDK_INT >= 31) {
            return location.isMock();
        }
        return location.isFromMockProvider();
    }
}
