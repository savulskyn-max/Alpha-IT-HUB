import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../../theme/colors';
import { Fonts, FontSizes, TextStyles } from '../../../theme/typography';

export default function AnalysisScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Análisis</Text>
      <View style={styles.placeholder}>
        <Text style={styles.icon}>📊</Text>
        <Text style={styles.text}>Panel de análisis y métricas.</Text>
        <Text style={styles.subtext}>Disponible en Fase 3.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  title: { ...TextStyles.h2, color: Colors.white, padding: 20 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  icon: { fontSize: 56, marginBottom: 16 },
  text: { fontFamily: Fonts.semiBold, fontSize: FontSizes.md, color: Colors.textSecondary, textAlign: 'center', marginBottom: 8 },
  subtext: { fontFamily: Fonts.regular, fontSize: FontSizes.sm, color: Colors.textMuted, textAlign: 'center' },
});
