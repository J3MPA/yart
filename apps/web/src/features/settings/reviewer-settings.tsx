import { useState } from 'react'
import {
  MAX_AI_REVIEW_ROUNDS,
  MAX_REVIEWER_COMMAND_LENGTH,
  MAX_REVIEWER_INSTRUCTIONS_LENGTH,
  MAX_REVIEWER_MODEL_LENGTH,
  MIN_AI_REVIEW_ROUNDS,
  REVIEWER_EFFORTS,
  type ReviewerEffort,
  type Settings,
} from '@yart/core'
import { useUpdateSettingsMutation } from '@/features/review/review-api'
import styles from './settings.module.css'

const ROUNDS = Array.from(
  { length: MAX_AI_REVIEW_ROUNDS - MIN_AI_REVIEW_ROUNDS + 1 },
  (_, index) => MIN_AI_REVIEW_ROUNDS + index,
)

/** Model names that Claude Code accepts as aliases. You can type all other names in full. */
const SUGGESTED_MODELS = ['opus', 'sonnet', 'haiku']

export interface ReviewerSettingsProps {
  settings: Settings
}

/**
 * How an AI reviewer must run. yart does not run a model. The process that
 * starts a reviewer reads these settings with the `get_reviewer_settings` tool.
 */
export const ReviewerSettings = ({ settings }: ReviewerSettingsProps) => {
  const [updateSettings, update_state] = useUpdateSettingsMutation()
  // Save typed text when the field loses focus, not on each key.
  const [model, setModel] = useState(settings.reviewer_model ?? '')
  const [instructions, setInstructions] = useState(settings.reviewer_instructions ?? '')
  const [command, setCommand] = useState(settings.reviewer_command ?? '')

  const saveText = (
    field: 'reviewer_model' | 'reviewer_instructions' | 'reviewer_command',
    value: string,
  ) => {
    if (value.trim() === (settings[field] ?? '')) return
    void updateSettings({ [field]: value })
  }

  return (
    <fieldset className={styles.group} disabled={update_state.isLoading}>
      <legend className={styles.legend}>AI reviewer</legend>

      <label className={styles.field}>
        <span className={styles.choice_label}>Rounds</span>
        <span className={styles.choice_detail}>
          How many verdicts an AI reviewer may pass on one review before it is yours to finish.
        </span>
        <select
          className={styles.input}
          value={settings.ai_review_rounds}
          onChange={(event) =>
            void updateSettings({ ai_review_rounds: Number(event.target.value) })
          }
        >
          {ROUNDS.map((rounds) => (
            <option key={rounds} value={rounds}>
              {rounds}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.choice_label}>Model</span>
        <span className={styles.choice_detail}>
          An alias such as sonnet, or a full model id. Empty leaves it to whatever starts the
          reviewer.
        </span>
        <input
          className={styles.input}
          list="reviewer-models"
          value={model}
          maxLength={MAX_REVIEWER_MODEL_LENGTH}
          placeholder="Its own choice"
          onChange={(event) => setModel(event.target.value)}
          onBlur={() => saveText('reviewer_model', model)}
        />
        <datalist id="reviewer-models">
          {SUGGESTED_MODELS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>

      <label className={styles.field}>
        <span className={styles.choice_label}>Effort</span>
        <span className={styles.choice_detail}>
          Passed on where the tool starting the reviewer takes one.
        </span>
        <select
          className={styles.input}
          value={settings.reviewer_effort ?? ''}
          onChange={(event) =>
            void updateSettings({
              reviewer_effort:
                event.target.value === '' ? null : (event.target.value as ReviewerEffort),
            })
          }
        >
          <option value="">Not set</option>
          {REVIEWER_EFFORTS.map((effort) => (
            <option key={effort} value={effort}>
              {effort}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.choice_label}>Instructions</span>
        <span className={styles.choice_detail}>
          What a reviewer should look for, added to its brief.
        </span>
        <textarea
          className={styles.textarea}
          rows={4}
          value={instructions}
          maxLength={MAX_REVIEWER_INSTRUCTIONS_LENGTH}
          placeholder="For example: look hardest at error handling and tests."
          onChange={(event) => setInstructions(event.target.value)}
          onBlur={() => saveText('reviewer_instructions', instructions)}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.choice_label}>Command for the commit hook</span>
        <span className={styles.choice_detail}>
          The shell command that starts a reviewer before each commit, in repositories where you ran{' '}
          <code>yart hook install</code>. Empty turns the hook off. The command gets the review in{' '}
          <code>YART_REVIEW_ID</code> and <code>YART_REVIEW_URL</code>, and these settings in{' '}
          <code>YART_REVIEWER_MODEL</code>, <code>YART_REVIEWER_EFFORT</code> and{' '}
          <code>YART_REVIEWER_INSTRUCTIONS</code>.
        </span>
        <textarea
          className={[styles.textarea, styles.code_input].join(' ')}
          rows={3}
          value={command}
          maxLength={MAX_REVIEWER_COMMAND_LENGTH}
          placeholder={
            'claude -p "Review the yart review $YART_REVIEW_ID as an AI reviewer." --model "${YART_REVIEWER_MODEL:-sonnet}"'
          }
          onChange={(event) => setCommand(event.target.value)}
          onBlur={() => saveText('reviewer_command', command)}
        />
      </label>
    </fieldset>
  )
}
