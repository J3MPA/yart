import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  hideUnchangedToggled,
  layoutChanged,
  type DiffLayout,
} from '@/features/diff/diffViewSlice';
import styles from './App.module.css';

const LAYOUTS: readonly DiffLayout[] = ['unified', 'split'];

export default function App() {
  const { layout, hideUnchanged } = useAppSelector((state) => state.diffView);
  const dispatch = useAppDispatch();

  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>yart</h1>
      <p className={styles.tagline}>
        Local, GitHub-style code review for AI-generated diffs.
      </p>

      <section className={styles.panel}>
        <h2 className={styles.panelHeading}>Scaffold check</h2>

        <div className={styles.controls}>
          {LAYOUTS.map((option) => (
            <button
              key={option}
              type="button"
              className={
                option === layout
                  ? `${styles.button} ${styles.buttonActive}`
                  : styles.button
              }
              onClick={() => dispatch(layoutChanged(option))}
            >
              {option}
            </button>
          ))}
          <button
            type="button"
            className={
              hideUnchanged
                ? `${styles.button} ${styles.buttonActive}`
                : styles.button
            }
            onClick={() => dispatch(hideUnchangedToggled())}
          >
            hide unchanged
          </button>
        </div>

        <pre className={styles.state}>
          {JSON.stringify({ layout, hideUnchanged }, null, 2)}
        </pre>

        <div className={styles.swatches}>
          <div className={`${styles.swatch} ${styles.swatchAdd}`}>+ added</div>
          <div className={`${styles.swatch} ${styles.swatchRemove}`}>- removed</div>
        </div>
      </section>
    </main>
  );
}
