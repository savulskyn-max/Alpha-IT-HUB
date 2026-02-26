import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../theme/colors';
import { Fonts, TextStyles } from '../../theme/typography';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/TextInput';

const schema = z.object({
  email: z.string().email('Ingresá un email válido'),
});

type Form = z.infer<typeof schema>;

export default function ForgotPasswordScreen() {
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: Form) => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(data.email);
      if (error) {
        Alert.alert('Error', error.message);
        return;
      }
      Alert.alert(
        'Email enviado',
        'Revisá tu bandeja de entrada para recuperar tu contraseña.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Recuperar contraseña</Text>
        <Text style={styles.subtitle}>
          Ingresá tu email y te enviamos un link para resetear tu contraseña.
        </Text>

        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              label="Email"
              placeholder="tu@tienda.com"
              keyboardType="email-address"
              autoCapitalize="none"
              onChangeText={onChange}
              onBlur={onBlur}
              value={value}
              error={errors.email?.message}
            />
          )}
        />

        <Button
          label="Enviar email"
          onPress={handleSubmit(onSubmit)}
          loading={loading}
          fullWidth
          style={styles.button}
        />
        <Button
          label="Volver"
          variant="ghost"
          onPress={() => router.back()}
          fullWidth
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  inner: { flex: 1, padding: 24, paddingTop: 80 },
  title: { ...TextStyles.h2, color: Colors.white, marginBottom: 12 },
  subtitle: { fontFamily: Fonts.regular, color: Colors.textSecondary, marginBottom: 32, lineHeight: 22 },
  button: { marginBottom: 12 },
});
