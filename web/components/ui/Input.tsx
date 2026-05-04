import * as React from "react";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export function Input({
  label,
  hint,
  error,
  className = "",
  id,
  ...rest
}: InputProps) {
  const reactId = React.useId();
  const inputId = id ?? reactId;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className="field">
      {label && (
        <label className="field-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy}
        className={`input ${error ? "error" : ""} ${className}`.trim()}
        {...rest}
      />
      {error ? (
        <div id={`${inputId}-err`} className="field-error">
          {error}
        </div>
      ) : hint ? (
        <div id={`${inputId}-hint`} className="field-hint">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
