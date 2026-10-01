import type { ApprovalAction } from '@yart/core'
import { useGetSettingsQuery, useUpdateSettingsMutation } from '@/features/review/review-api'
import styles from './settings.module.css'

const CHOICES: readonly { value: ApprovalAction; label: string; detail: string }[] = [
  {
    value: 'keep',
    label: 'Keep it',
    detail: 'It stays in the list until you archive or delete it.',
  },
  {
    value: 'archive',
    label: 'Archive it',
    detail: 'It moves to Archived, from where it can be restored.',
  },
  {
    value: 'delete',
    label: 'Delete it',
    detail: 'It is deleted with every comment on it. This cannot be undone.',
  },
]

/** The daemon's settings, which apply in the app and in every browser alike. */
export const SettingsPage = () => {
  const { data: settings, isLoading: is_loading, isError: is_error } = useGetSettingsQuery()
  const [updateSettings, update_state] = useUpdateSettingsMutation()

  return (
    <>
      <a className={styles.back} href="/">
        ← All reviews
      </a>
      <h1 className={styles.title}>Settings</h1>

      {is_loading && <p className={styles.notice}>Loading settings…</p>}
      {is_error && <p className={styles.notice}>The settings could not be loaded.</p>}

      {settings !== undefined && (
        <fieldset className={styles.group} disabled={update_state.isLoading}>
          <legend className={styles.legend}>When a review is approved</legend>
          {CHOICES.map((choice) => (
            <label key={choice.value} className={styles.choice}>
              <input
                type="radio"
                name="on_approve"
                className={styles.radio}
                value={choice.value}
                checked={settings.on_approve === choice.value}
                onChange={() => void updateSettings({ on_approve: choice.value })}
              />
              <span>
                <span className={styles.choice_label}>{choice.label}</span>
                <span className={styles.choice_detail}>{choice.detail}</span>
              </span>
            </label>
          ))}
          <p className={styles.note}>
            It happens a minute after the approval, so that an agent waiting on the review reads the
            verdict first, and not at all if the review is reopened in that minute. Reviews approved
            before this was chosen are left as they are.
          </p>
        </fieldset>
      )}
    </>
  )
}
