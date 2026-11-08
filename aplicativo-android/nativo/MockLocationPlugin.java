// REOBOTE | aplicativo-android/nativo/MockLocationPlugin.java — APK: detecta GPS falso (localização simulada) no Android
package br.com.reobote.app;

import android.app.AppOpsManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
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
 * Plugin nativo do REOBOTE que responde à pergunta: "este celular tem GPS falso?".
 *
 * Regra (a mesma usada por jogos como Pokémon GO e por apps de ponto rígidos):
 *  1. APP DE GPS FALSO INSTALADO: todo app que simula localização precisa declarar ao Android a permissão
 *     ACCESS_MOCK_LOCATION (é assim que ele aparece em "app de local fictício" nas opções do desenvolvedor).
 *     Se algum app instalado pelo usuário (não do sistema) declara essa permissão, o celular é bloqueado
 *     para registrar ponto até o app ser desinstalado.
 *  2. ATIVADO: quando o Android permite conferir, informa também se esse app está escolhido como
 *     "app de local fictício" (em Androids novos essa consulta é proibida; o erro é ignorado por app).
 *  3. POSIÇÃO SIMULADA: a última posição conhecida (GPS, rede e provedor combinado) veio marcada como falsa.
 *
 * No JavaScript: window.Capacitor.registerPlugin("MockLocation").check()
 *   -> { mock, mockApps: ["Simulador GPS (com.exemplo.app)"], enabledApps: [...], lastLocationMock, errors: [...] }
 *
 * Copiado para o projeto Android e registrado no MainActivity pelo script scripts/configurar-android.mjs.
 */
@CapacitorPlugin(name = "MockLocation")
public class MockLocationPlugin extends Plugin {

    @PluginMethod
    public void check(PluginCall call) {
        Context context = getContext();
        JSArray mockApps = new JSArray();     // apps de GPS falso instalados
        JSArray enabledApps = new JSArray();  // desses, os escolhidos como "app de local fictício"
        JSArray errors = new JSArray();       // problemas encontrados (enviados no diagnóstico)
        boolean lastLocationMock = false;
        PackageManager packageManager = context.getPackageManager();

        // 1 e 2. Apps instalados que declaram a permissão de simular localização.
        List<PackageInfo> packages = null;
        try {
            packages = packageManager.getInstalledPackages(PackageManager.GET_PERMISSIONS);
        } catch (Exception error) {
            errors.put("lista de apps: " + error.getClass().getSimpleName() + " " + error.getMessage());
        }
        AppOpsManager appOps = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            appOps = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        }
        if (packages != null) {
            for (PackageInfo info : packages) {
                try {
                    if (info.requestedPermissions == null || info.applicationInfo == null || context.getPackageName().equals(info.packageName)) {
                        continue;
                    }
                    // Apps do sistema (do fabricante) ficam de fora, para não bloquear celulares sem motivo.
                    if ((info.applicationInfo.flags & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0) {
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
                    String name = packageManager.getApplicationLabel(info.applicationInfo).toString() + " (" + info.packageName + ")";
                    mockApps.put(name);
                    if (appOps != null) {
                        try {
                            int mode = appOps.checkOpNoThrow(AppOpsManager.OPSTR_MOCK_LOCATION, info.applicationInfo.uid, info.packageName);
                            if (mode == AppOpsManager.MODE_ALLOWED) {
                                enabledApps.put(name);
                            }
                        } catch (Exception ignored) {
                            // Android novo não deixa consultar outros apps: basta saber que está instalado.
                        }
                    }
                } catch (Exception error) {
                    errors.put(info.packageName + ": " + error.getClass().getSimpleName());
                }
            }
        }
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                && !"0".equals(Settings.Secure.getString(context.getContentResolver(), "mock_location"))) {
                // Android 5 (antigo): uma única chave "permitir locais fictícios".
                enabledApps.put("Locais fictícios permitidos");
            }
        } catch (Exception ignored) {
            // Configuração indisponível.
        }

        // 3. Última posição conhecida marcada como simulada.
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
        } catch (Exception error) {
            errors.put("localização: " + error.getClass().getSimpleName());
        }

        JSObject result = new JSObject();
        result.put("mock", mockApps.length() > 0 || enabledApps.length() > 0 || lastLocationMock);
        result.put("mockApps", mockApps);
        result.put("enabledApps", enabledApps);
        result.put("lastLocationMock", lastLocationMock);
        result.put("checkedApps", packages == null ? 0 : packages.size());
        result.put("errors", errors);
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
