import { StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { Colors } from '../../theme/colors';

interface CardProps extends ViewProps {
  style?: ViewStyle;
  padding?: number;
}

export function Card({ children, style, padding = 16, ...props }: CardProps) {
  return (
    <View style={[styles.card, { padding }, style]} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
});
