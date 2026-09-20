import type { ButtonHTMLAttributes } from 'react'
import styles from './button.module.css'

export type ButtonTone = 'default' | 'primary' | 'quiet'

const TONE_CLASS: Record<ButtonTone, string> = {
  default: '',
  primary: styles.primary as string,
  quiet: styles.quiet as string,
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone
}

export const Button = ({ tone = 'default', className: class_name, ...rest }: ButtonProps) => (
  <button
    type="button"
    className={[styles.button, TONE_CLASS[tone], class_name].filter(Boolean).join(' ')}
    {...rest}
  />
)
