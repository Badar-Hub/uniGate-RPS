import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n';

/**
 * A page-sheet modal for a secondary form or action (cancel booking, revise bid, upload a
 * document, add a calendar block). The title is LTR when it is an identifier (booking / bid
 * number); a Back button closes it, and `onRequestClose` handles the Android back gesture.
 */
export function Sheet({
  title,
  onClose,
  children,
  ltrTitle = false,
  closeLabel,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  ltrTitle?: boolean;
  closeLabel?: string | undefined;
}) {
  const { t } = useI18n();
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="p-4 pb-12">
            <Text
              className="mb-3 text-xl font-bold text-foreground text-start"
              style={ltrTitle ? { writingDirection: 'ltr' } : undefined}
            >
              {title}
            </Text>
            {children}
            <View className="mt-3">
              <Button title={closeLabel ?? t('common.back')} variant="ghost" onPress={onClose} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
