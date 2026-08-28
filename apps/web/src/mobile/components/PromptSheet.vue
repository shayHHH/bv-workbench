<script setup lang="ts">
/**
 * 通用底部输入弹层：替代桌面 ElMessageBox.prompt（取消原因、收U地址、驳回原因等）。
 * open() 返回 Promise<string | null>：确认返回输入值（可为空串），取消返回 null。
 */
import { Button as VanButton, Field as VanField, Popup as VanPopup } from "vant";
import { reactive, ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const visible = ref(false);
const value = ref("");
const state = reactive({
  title: "",
  message: "",
  placeholder: "",
  confirmText: "",
  /** 必填时输入为空禁用确认 */
  required: false,
  multiline: false,
});

let resolver: ((result: string | null) => void) | null = null;

function open(options: {
  title: string;
  message?: string;
  placeholder?: string;
  confirmText?: string;
  required?: boolean;
  multiline?: boolean;
}): Promise<string | null> {
  state.title = options.title;
  state.message = options.message ?? "";
  state.placeholder = options.placeholder ?? "";
  state.confirmText = options.confirmText || t("orders.common.approve");
  state.required = options.required ?? false;
  state.multiline = options.multiline ?? false;
  value.value = "";
  visible.value = true;
  return new Promise(resolve => {
    resolver = resolve;
  });
}

function settle(result: string | null) {
  visible.value = false;
  resolver?.(result);
  resolver = null;
}

defineExpose({ open });
</script>

<template>
  <van-popup
    v-model:show="visible"
    position="bottom"
    round
    safe-area-inset-bottom
    @closed="resolver && settle(null)"
  >
    <div class="prompt-sheet">
      <h3>{{ state.title }}</h3>
      <p v-if="state.message" class="message">{{ state.message }}</p>
      <van-field
        v-model="value"
        :type="state.multiline ? 'textarea' : 'text'"
        :rows="state.multiline ? 3 : undefined"
        :autosize="state.multiline"
        :placeholder="state.placeholder"
        class="input"
      />
      <div class="buttons">
        <van-button block @click="settle(null)">{{ t("orders.common.cancel") }}</van-button>
        <van-button
          block
          type="primary"
          :disabled="state.required && !value.trim()"
          @click="settle(value.trim())"
        >
          {{ state.confirmText }}
        </van-button>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
.prompt-sheet {
  padding: 20px 16px 16px;
}

h3 {
  margin: 0 0 8px;
  font-size: 16px;
  text-align: center;
}

.message {
  color: #606266;
  font-size: 13px;
  margin: 0 0 12px;
  line-height: 1.6;
}

.input {
  background: #f6f7f9;
  border-radius: 8px;
  margin-bottom: 14px;
}

.buttons {
  display: flex;
  gap: 10px;
}
</style>
