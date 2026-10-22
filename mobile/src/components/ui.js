import { cva } from 'class-variance-authority';
import { cssInterop } from 'nativewind';
import { Pressable, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { cn } from '../lib/cn';
import { usePalette } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
// Animasyonlu bileşen de className kabul etsin
cssInterop(AnimatedPressable, { className: 'style' });

// Basınca hafifçe küçülen dokunma alanı
export function PressableScale({ style, onPressIn, onPressOut, disabled, ...props }) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      style={[animated, style]}
      onPressIn={(e) => {
        scale.value = withSpring(0.96, { damping: 20, stiffness: 400 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 20, stiffness: 400 });
        onPressOut?.(e);
      }}
    />
  );
}

const button = cva('flex-row items-center justify-center rounded-xl', {
  variants: {
    variant: {
      primary: 'bg-brand',
      soft: 'bg-brand-soft dark:bg-night-line',
      danger: 'bg-bad-soft dark:bg-bad/20',
      outline: 'border border-surface-line bg-surface dark:border-night-line dark:bg-night-card',
    },
    size: {
      sm: 'gap-1.5 px-3 py-2',
      md: 'gap-2 px-4 py-3',
      lg: 'gap-2 px-5 py-3.5',
    },
    disabled: { true: 'opacity-50' },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

const buttonText = cva('font-semibold', {
  variants: {
    variant: {
      primary: 'text-white',
      soft: 'text-brand dark:text-white',
      danger: 'text-bad',
      outline: 'text-ink dark:text-white',
    },
    size: { sm: 'text-[13px]', md: 'text-[15px]', lg: 'text-base' },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

const ICON_COLORS = { primary: '#FFFFFF', soft: null, danger: '#D93025', outline: null };

export function Button({ label, icon: Icon, onPress, variant = 'primary', size = 'md', disabled, className }) {
  const palette = usePalette();
  const iconColor = ICON_COLORS[variant] ?? (variant === 'soft' ? palette.brand : palette.text);
  return (
    <PressableScale onPress={onPress} disabled={disabled} accessibilityRole="button" className={cn(button({ variant, size, disabled }), className)}>
      {Icon ? <Icon size={size === 'sm' ? 15 : 18} color={iconColor} /> : null}
      {label ? <Text className={buttonText({ variant, size })}>{label}</Text> : null}
    </PressableScale>
  );
}

export function Chip({ label, icon: Icon, active, onPress, color }) {
  const palette = usePalette();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={cn(
        'mb-1.5 mr-1.5 flex-row items-center gap-1.5 rounded-full border px-3 py-1.5',
        active ? 'border-brand bg-brand' : 'border-surface-line bg-surface dark:border-night-line dark:bg-night-card',
      )}
      style={active && color ? { backgroundColor: color, borderColor: color } : null}
    >
      {Icon ? <Icon size={14} color={active ? '#FFFFFF' : palette.muted} /> : null}
      {!active && color ? <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} /> : null}
      <Text className={cn('text-[13px]', active ? 'font-semibold text-white' : 'text-ink dark:text-white')}>{label}</Text>
    </PressableScale>
  );
}

const badge = cva('overflow-hidden rounded-md px-2 py-0.5 text-[11px] font-bold', {
  variants: {
    tone: {
      ok: 'bg-ok-soft text-ok dark:bg-ok/20 dark:text-green-400',
      bad: 'bg-bad-soft text-bad dark:bg-bad/25 dark:text-red-300',
      warn: 'bg-warn-soft text-warn dark:bg-warn/25 dark:text-amber-300',
      brand: 'bg-brand-soft text-brand dark:bg-brand/25 dark:text-blue-300',
    },
  },
  defaultVariants: { tone: 'brand' },
});

export function Badge({ tone, children }) {
  return <Text className={badge({ tone })}>{children}</Text>;
}

export function Field({ label, className, inputClassName, ...props }) {
  const palette = usePalette();
  return (
    <View className={cn('flex-1', className)}>
      {label ? <Text className="mb-1 text-xs text-ink-muted dark:text-night-muted">{label}</Text> : null}
      <TextInput
        placeholderTextColor={palette.muted}
        className={cn(
          'rounded-xl border border-surface-line bg-surface px-3 py-2.5 text-[15px] text-ink dark:border-night-line dark:bg-night-card dark:text-white',
          inputClassName,
        )}
        {...props}
      />
    </View>
  );
}

export function Card({ className, children, ...props }) {
  return (
    <View className={cn('rounded-xl2 border border-surface-line bg-surface p-3 dark:border-night-line dark:bg-night-card', className)} {...props}>
      {children}
    </View>
  );
}

export function Row({ children, className }) {
  return <View className={cn('flex-row items-end gap-2', className)}>{children}</View>;
}

export function SectionTitle({ children }) {
  return <Text className="mb-1.5 mt-3.5 text-xs font-bold uppercase tracking-wide text-ink-muted dark:text-night-muted">{children}</Text>;
}
