import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { Colors } from '../theme/colors';

/**
 * Root redirect: check auth state and navigate to the right section.
 * Shows a loading indicator while the auth state is initializing.
 */
export default function Index() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  if (session) {
    return <Redirect href="/(app)/(tabs)/" />;
  }

  return <Redirect href="/(auth)/login" />;
}
