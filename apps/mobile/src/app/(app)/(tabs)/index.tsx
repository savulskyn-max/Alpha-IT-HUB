import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../theme/colors';
import { Fonts, FontSizes, TextStyles } from '../../../theme/typography';
import { Card } from '../../../components/ui/Card';

export default function HomeScreen() {
  const { user } = useAuth();
  const name = user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? 'Usuario';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hola, {name} 👋</Text>
            <Text style={styles.subtitle}>Tu equipo de IA está listo</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
          </View>
        </View>

        {/* KPI Cards — placeholder values */}
        <Text style={styles.sectionTitle}>Resumen del día</Text>
        <View style={styles.kpiGrid}>
          <Card style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Ventas hoy</Text>
            <Text style={styles.kpiValue}>—</Text>
            <Text style={styles.kpiHint}>Conectá tu base de datos</Text>
          </Card>
          <Card style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Ticket promedio</Text>
            <Text style={styles.kpiValue}>—</Text>
            <Text style={styles.kpiHint}>Conectá tu base de datos</Text>
          </Card>
          <Card style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Stock crítico</Text>
            <Text style={styles.kpiValue}>—</Text>
            <Text style={styles.kpiHint}>Conectá tu base de datos</Text>
          </Card>
          <Card style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Baja rotación</Text>
            <Text style={styles.kpiValue}>—</Text>
            <Text style={styles.kpiHint}>Conectá tu base de datos</Text>
          </Card>
        </View>

        {/* Agent activity feed — placeholder */}
        <Text style={styles.sectionTitle}>Actividad de agentes</Text>
        <Card style={styles.feedCard}>
          <View style={styles.emptyFeed}>
            <Text style={styles.emptyFeedIcon}>🤖</Text>
            <Text style={styles.emptyFeedText}>
              Tus agentes aparecerán aquí una vez configurados.
            </Text>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  greeting: {
    ...TextStyles.h3,
    color: Colors.white,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: Fonts.regular,
    fontSize: FontSizes.sm,
    color: Colors.textSecondary,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Fonts.bold,
    fontSize: FontSizes.md,
    color: Colors.white,
  },
  sectionTitle: {
    fontFamily: Fonts.semiBold,
    fontSize: FontSizes.base,
    color: Colors.textSecondary,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 14,
    marginBottom: 24,
    gap: 8,
  },
  kpiCard: {
    width: '47%',
    padding: 14,
  },
  kpiLabel: {
    fontFamily: Fonts.medium,
    fontSize: FontSizes.xs,
    color: Colors.textMuted,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  kpiValue: {
    fontFamily: Fonts.bold,
    fontSize: FontSizes['2xl'],
    color: Colors.white,
    marginBottom: 4,
  },
  kpiHint: {
    fontFamily: Fonts.regular,
    fontSize: FontSizes.xs,
    color: Colors.textMuted,
  },
  feedCard: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  emptyFeed: {
    padding: 24,
    alignItems: 'center',
  },
  emptyFeedIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyFeedText: {
    fontFamily: Fonts.regular,
    fontSize: FontSizes.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
