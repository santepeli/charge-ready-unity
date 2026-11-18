import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Asset } from 'expo-asset';
import { WebView } from 'react-native-webview';

// Shows the offline game page full screen, like the Android shell.
export default function App() {
  const [uri, setUri] = useState(null);
  useEffect(() => { Asset.fromModule(require('./assets/game.html')).downloadAsync().then((a) => setUri(a.localUri)); }, []);
  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {uri && (
        <WebView
          source={{ uri }}
          allowingReadAccessToURL={uri.slice(0, uri.lastIndexOf('/') + 1)}
          originWhitelist={['*']}
          allowFileAccess
          allowFileAccessFromFileURLs
          scrollEnabled={false}
          bounces={false}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          style={styles.root}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#bfe8ff' } });
