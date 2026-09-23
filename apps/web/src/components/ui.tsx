// Design system primitives. Every control here is real: no decorative inputs.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { Icon, type IconName } from './Icon.tsx';
import { tr } from '../i18n/index.ts';

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button(props: {
  children: ComponentChildren;
  onClick?: (e: MouseEvent) => void;
  variant?: BtnVariant;
  icon?: IconName;
  type?: 'button' | 'submit';
  disabled?: boolean;
  busy?: boolean;
  full?: boolean;
  small?: boolean;
  label?: string;
}) {
  const { variant = 'secondary', icon, type = 'button', disabled, busy, full, small } = props;
  return (
    <button
      type={type}
      class={`btn btn-${variant}${full ? ' btn-full' : ''}${small ? ' btn-small' : ''}`}
      onClick={props.onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={props.label}
    >
      {busy ? <span class="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={18} /> : null}
      <span>{props.children}</span>
    </button>
  );
}

export function IconButton({ icon, label, onClick, class: cls = '' }: { icon: IconName; label: string; onClick: () => void; class?: string }) {
  return (
    <button type="button" class={`icon-btn ${cls}`} onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  );
}

export function Card({ children, class: cls = '', onClick }: { children: ComponentChildren; class?: string; onClick?: () => void }) {
  return (
    <div class={`card ${cls}`} onClick={onClick}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children, id }: { label: string; hint?: string; children: ComponentChildren; id: string }) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {children}
      {hint && <p class="hint">{hint}</p>}
    </div>
  );
}

export function Input(props: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'value' | 'label'> & { label: string; hint?: string; value: string; onValue: (v: string) => void }) {
  const id = useId();
  const { label, hint, onValue, ...rest } = props;
  return (
    <Field label={label} hint={hint} id={id}>
      <input id={id} class="input" {...rest} value={props.value} onInput={(e) => onValue((e.target as HTMLInputElement).value)} />
    </Field>
  );
}

export function TextArea(props: { label: string; value: string; onValue: (v: string) => void; rows?: number; placeholder?: string }) {
  const id = useId();
  return (
    <Field label={props.label} id={id}>
      <textarea id={id} class="input" rows={props.rows ?? 3} placeholder={props.placeholder} value={props.value} onInput={(e) => props.onValue((e.target as HTMLTextAreaElement).value)} />
    </Field>
  );
}

export function Select<T extends string>(props: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; hint?: string }) {
  const id = useId();
  return (
    <Field label={props.label} hint={props.hint} id={id}>
      <div class="select-wrap">
        <select id={id} class="input" value={props.value} onChange={(e) => props.onChange((e.target as HTMLSelectElement).value as T)}>
          {props.options.map((o) => (
            <option value={o.value} key={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </Field>
  );
}

export function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div class="row toggle-row">
      <div class="row-text">
        <label for={id} class="row-label">
          {props.label}
        </label>
        {props.hint && <p class="hint">{props.hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={props.checked}
        disabled={props.disabled}
        class={`switch${props.checked ? ' on' : ''}`}
        onClick={() => props.onChange(!props.checked)}
      >
        <span class="knob" aria-hidden="true" />
      </button>
    </div>
  );
}

export function Segmented<T extends string>(props: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div class="field">
      <span class="field-label" id={`${props.label}-lbl`}>
        {props.label}
      </span>
      <div class="segmented" role="radiogroup" aria-label={props.label}>
        {props.options.map((o) => (
          <button type="button" role="radio" aria-checked={o.value === props.value} class={o.value === props.value ? 'active' : ''} onClick={() => props.onChange(o.value)} key={o.value}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Section({ title, children, id }: { title: string; children: ComponentChildren; id?: string }) {
  return (
    <section class="section" aria-labelledby={id ? `${id}-h` : undefined} id={id}>
      <h2 class="section-title" id={id ? `${id}-h` : undefined}>
        {title}
      </h2>
      <div class="section-body">{children}</div>
    </section>
  );
}

/** Bottom sheet dialog: focus moves in, Escape / backdrop closes, focus returns. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, a[href]')];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div class="sheet-handle" aria-hidden="true" />
        <div class="sheet-head">
          <h2>{title}</h2>
          <IconButton icon="close" label={tr('common.close')} onClick={onClose} />
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Confirm(props: { open: boolean; title: string; body?: string; confirm: string; cancel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void; children?: ComponentChildren; confirmDisabled?: boolean }) {
  return (
    <Sheet open={props.open} onClose={props.onCancel} title={props.title}>
      {props.body && <p class="muted">{props.body}</p>}
      {props.children}
      <div class="actions-row">
        <Button onClick={props.onCancel}>{props.cancel}</Button>
        <Button variant={props.danger ? 'danger' : 'primary'} onClick={props.onConfirm} disabled={props.confirmDisabled}>
          {props.confirm}
        </Button>
      </div>
    </Sheet>
  );
}

export function EmptyState({ text, children }: { text: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="empty-mark" aria-hidden="true" />
      <p>{text}</p>
      {children}
    </div>
  );
}
