import React, { useState, useEffect, useCallback } from 'react';
import { useStripeElements } from '../hooks/useStripeElements';
import { validateCard } from '../utils/cardValidation';
import { useCheckoutContext } from '../contexts/CheckoutContext';

interface PaymentFormProps {
  initialData?: Partial<PaymentFormData>;
  onSubmit: (token: StripeToken) => Promise<void>;
  onBack: () => void;
  maxRetries?: number;
}

interface PaymentFormData {
  cardNumber: string;
  expiry: string;
  cvc: string;
  zip?: string;
}

const PaymentForm: React.FC<PaymentFormProps> = ({
  initialData,
  onSubmit,
  onBack,
  maxRetries = 2,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [cardComplete, setCardComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { customerType, billingAddress } = useCheckoutContext();
  const { stripeReady, tokenize } = useStripeElements();

  useEffect(() => {
    if (initialData) {
      // Pre-fill form when returning from review step
    }
  }, [initialData]);

  const handleSubmit = useCallback(async () => {
    if (isProcessing || !cardComplete) return;

    setIsProcessing(true);
    setError(null);

    try {
      const token = await tokenize();
      await onSubmit(token);
    } catch (err) {
      setRetryCount(prev => prev + 1);
      if (retryCount >= maxRetries) {
        setError('Please try a different card.');
      } else {
        setError('Payment failed. Please try again.');
      }
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, cardComplete, tokenize, onSubmit, retryCount, maxRetries]);

  if (!stripeReady) {
    return <ManualCardEntry onSubmit={onSubmit} onBack={onBack} />;
  }

  return (
    <div className="payment-form">
      <StripeCardElement onChange={(e) => setCardComplete(e.complete)} />
      {customerType === 'US' && <ZipCodeInput />}
      {error && <ErrorMessage message={error} />}
      {retryCount >= maxRetries && <AlternateCardSuggestion />}
      <button
        onClick={handleSubmit}
        disabled={isProcessing || !cardComplete}
      >
        {isProcessing ? 'Processing...' : 'Pay Now'}
      </button>
      <button onClick={onBack}>Back</button>
    </div>
  );
};

export default PaymentForm;
