import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../theme/colors';
import { Fonts, FontSizes, TextStyles } from '../../../theme/typography';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';

export default function ProfileScreen() {
  const { user, userRole } = useAuth();

  const handleSignOut = () => {
    Alert.alert('Cerrar sesión', '¿Estás seguro que querés cerrar sesión?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesión',
        style: 'destructive',
        onPress: () => supabase.auth.signOut(),
      },
    ]);
  };

  const email = user?.email ?? '';
  const displayName = user?.user_metadata?.full_name ?? email.split('@')[0] ?? 'Usuario';

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Perfil</Text>

      <Card style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>{displayName}</Text>
        <Text style={styles.email}>{email}</Text>
        {userRole && (
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{userRole}</Text>
          </View>
        )}
      </Card>

      <Button
        label="Cerrar sesión"
        variant="secondary"
        onPress={handleSignOut}
        fullWidth
        style={styles.signOutButton}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 20 },
  title: { ...TextStyles.h2, color: Colors.white, paddingTop: 8, marginBottom: 20 },
  profileCard: {
    alignItems: 'center',
    padding: 28,
    marginBottom: 24,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarText: { fontFamily: Fonts.bold, fontSize: FontSizes.xl, color: Colors.white },
  name: { fontFamily: Fonts.semiBold, fontSize: FontSizes.lg, color: Colors.white, marginBottom: 4 },
  email: { fontFamily: Fonts.regular, fontSize: FontSizes.sm, color: Colors.textSecondary, marginBottom: 12 },
  roleBadge: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  roleText: { fontFamily: Fonts.medium, fontSize: FontSizes.xs, color: Colors.white, textTransform: 'capitalize' },
  signOutButton: { marginTop: 'auto' },
});
