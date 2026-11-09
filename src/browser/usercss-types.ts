export type UserCSSValue = string | number;
export type UserCSSValues = Readonly<Record<string, UserCSSValue>>;
export interface UserCSSVariable {
  readonly name: string;
  readonly label: string;
  readonly type: 'text' | 'color' | 'checkbox' | 'select' | 'dropdown' | 'image' | 'number' | 'range';
  readonly default: UserCSSValue;
  readonly value: UserCSSValue | null;
  readonly options?: readonly { name: string; label: string; value: string }[] | null;
  readonly min?: number | null;
  readonly max?: number | null;
  readonly step?: number | null;
  readonly units?: string | null;
}
export interface UserCSSMetadata {
  readonly name: string;
  readonly namespace: string;
  readonly version: string;
  readonly description?: string;
  readonly updateURL?: string;
  readonly preprocessor: 'default' | 'uso' | 'less' | 'stylus';
  readonly vars: Readonly<Record<string, UserCSSVariable>>;
}
export interface UserCSSConfiguration { readonly values: UserCSSValues }
