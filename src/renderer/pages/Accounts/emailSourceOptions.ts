export const EMAIL_SOURCE_OPTIONS = [
  { value: 'manual', label: 'Nhập tay' },
  { value: 'gmail94', label: 'Gmail94' },
  { value: 'dongvanfb', label: 'DongVanFB' },
  { value: 'customdomain', label: 'Domain riêng' }
] as const;

export type EmailSourceValue = (typeof EMAIL_SOURCE_OPTIONS)[number]['value'];

export function getEmailSourceOptions(currentValue?: string): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [...EMAIL_SOURCE_OPTIONS];
  if (currentValue && !options.some((opt) => opt.value === currentValue)) {
    options.push({ value: currentValue, label: `${currentValue} (legacy)` });
  }
  return options;
}
