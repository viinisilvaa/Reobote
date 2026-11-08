// REOBOTE | aplicativo-android/nativo/MainActivity.java — APK: tela principal do app com os plugins próprios do REOBOTE
package br.com.reobote.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Tela principal do APK (substitui a gerada pelo Capacitor).
 * Registra os plugins nativos próprios do REOBOTE ANTES de criar a tela, como o Capacitor exige.
 * Copiado para o projeto Android pelo script scripts/configurar-android.mjs.
 */
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MockLocationPlugin.class); // detecção de GPS falso
        super.onCreate(savedInstanceState);
    }
}
