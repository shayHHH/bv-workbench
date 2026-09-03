<script setup lang="ts">
/**
 * 公式编辑器：contenteditable，变量渲染为不可编辑胶囊，对外值为结构化 token 数组。
 * 数字/运算符为普通文本；输入时把 DOM 解析回 token 并 emit（单向数据流，
 * 外部值变化只在与内部序列化不一致时才重渲染，避免光标跳动）。
 */
import type { FormulaOperator, FormulaToken, VariableSource } from "@bv/shared";
import { onMounted, ref, watch } from "vue";

const props = defineProps<{
  modelValue: FormulaToken[];
  error?: string | null;
  placeholder?: string;
}>();
const emit = defineEmits<{ (e: "update:modelValue", value: FormulaToken[]): void }>();

const editorRef = ref<HTMLDivElement>();
let savedRange: Range | null = null;
let lastSerialized = "";

function serialize(tokens: FormulaToken[]): string {
  return JSON.stringify(tokens);
}

function badgeElement(token: Extract<FormulaToken, { type: "var" }>): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "var-badge";
  span.contentEditable = "false";
  span.dataset.source = token.source;
  span.dataset.code = token.code;
  span.textContent = token.label;
  return span;
}

function renderTokens(tokens: FormulaToken[]): void {
  const editor = editorRef.value;
  if (!editor) return;
  editor.innerHTML = "";
  for (const token of tokens) {
    if (token.type === "var") {
      editor.appendChild(badgeElement(token));
    } else {
      editor.appendChild(document.createTextNode(` ${token.value} `));
    }
  }
  editor.normalize();
}

function parseDom(): FormulaToken[] {
  const editor = editorRef.value;
  if (!editor) return [];
  const tokens: FormulaToken[] = [];
  for (const node of Array.from(editor.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList.contains("var-badge")) {
      const el = node as HTMLElement;
      tokens.push({
        type: "var",
        source: el.dataset.source as VariableSource,
        code: el.dataset.code ?? "",
        label: el.textContent ?? "",
      });
      continue;
    }
    const text = node.textContent ?? "";
    /* 数字 / 运算符逐段切词；其余字符原样保留为 num token，由求值器报错提示 */
    const pattern = /(\d+(?:\.\d+)?)|([+\-*/()×÷−])|(\S)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match[1]) tokens.push({ type: "num", value: match[1] });
      else if (match[2]) {
        const op = match[2].replace("×", "*").replace("÷", "/").replace("−", "-");
        tokens.push({ type: "op", value: op as FormulaOperator });
      } else tokens.push({ type: "num", value: match[3] });
    }
  }
  return tokens;
}

function handleInput(): void {
  const tokens = parseDom();
  lastSerialized = serialize(tokens);
  emit("update:modelValue", tokens);
}

function saveSelection(): void {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (editorRef.value?.contains(range.commonAncestorContainer)) {
    savedRange = range.cloneRange();
  }
}

function insertNode(node: Node): void {
  const editor = editorRef.value;
  if (!editor) return;
  editor.focus();
  const selection = window.getSelection();
  let range = savedRange;
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
  savedRange = range.cloneRange();
  handleInput();
}

function insertVariable(token: Extract<FormulaToken, { type: "var" }>): void {
  insertNode(badgeElement(token));
}

function insertOperator(op: string): void {
  insertNode(document.createTextNode(` ${op} `));
}

function clear(): void {
  const editor = editorRef.value;
  if (!editor) return;
  editor.innerHTML = "";
  savedRange = null;
  handleInput();
}

defineExpose({ insertVariable, insertOperator, clear });

watch(
  () => props.modelValue,
  value => {
    if (serialize(value) !== lastSerialized) {
      lastSerialized = serialize(value);
      renderTokens(value);
    }
  },
  { deep: true },
);

onMounted(() => {
  lastSerialized = serialize(props.modelValue);
  renderTokens(props.modelValue);
});
</script>

<template>
  <div
    ref="editorRef"
    class="formula-editor"
    :class="{ error: !!error }"
    contenteditable="true"
    :data-placeholder="placeholder"
    spellcheck="false"
    @input="handleInput"
    @keyup="saveSelection"
    @mouseup="saveSelection"
    @blur="saveSelection"
  />
</template>

<style scoped>
.formula-editor {
  min-height: 30px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 4px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 20px;
  background: #fff;
  outline: none;
  word-break: break-all;
}

.formula-editor:focus {
  border-color: var(--color-primary);
}

.formula-editor.error {
  border-color: var(--color-danger);
}

.formula-editor:empty::before {
  content: attr(data-placeholder);
  color: #a8abb2;
}

.formula-editor :deep(.var-badge),
.formula-editor .var-badge {
  display: inline-block;
  background: var(--color-primary-light);
  color: var(--color-primary);
  border: 1px solid var(--color-primary-light);
  border-radius: 999px;
  padding: 0 9px;
  margin: 0 2px;
  font-size: 12px;
  line-height: 20px;
  user-select: none;
  white-space: nowrap;
}
</style>
