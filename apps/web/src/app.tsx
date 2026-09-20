import { useAppDispatch, useAppSelector } from '@/store/hooks'
import {
  hideUnchangedToggled,
  layoutChanged,
  type DiffLayout,
} from '@/features/diff/diff-view-slice'
import styles from './app.module.css'

const LAYOUTS: readonly DiffLayout[] = ['unified', 'split']

const App = () => {
  const { layout, hide_unchanged } = useAppSelector((state) => state.diff_view)
  const dispatch = useAppDispatch()

  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>yart</h1>
      <p className={styles.tagline}>Local, GitHub-style code review for AI-generated diffs.</p>

      <section className={styles.panel}>
        <h2 className={styles.panel_heading}>Scaffold check</h2>

        <div className={styles.controls}>
          {LAYOUTS.map((option) => (
            <button
              key={option}
              type="button"
              className={
                option === layout ? `${styles.button} ${styles.button_active}` : styles.button
              }
              onClick={() => dispatch(layoutChanged(option))}
            >
              {option}
            </button>
          ))}
          <button
            type="button"
            className={hide_unchanged ? `${styles.button} ${styles.button_active}` : styles.button}
            onClick={() => dispatch(hideUnchangedToggled())}
          >
            hide unchanged
          </button>
        </div>

        <pre className={styles.state}>{JSON.stringify({ layout, hide_unchanged }, null, 2)}</pre>

        <div className={styles.swatches}>
          <div className={`${styles.swatch} ${styles.swatch_add}`}>+ added</div>
          <div className={`${styles.swatch} ${styles.swatch_remove}`}>- removed</div>
        </div>
      </section>
    </main>
  )
}

export default App
