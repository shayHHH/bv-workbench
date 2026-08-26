<script setup lang="ts">
import elZhCn from "element-plus/es/locale/lang/zh-cn";
import elZhTw from "element-plus/es/locale/lang/zh-tw";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { locale } = useI18n();
const elementLocale = computed(() => (locale.value === "zh-TW" ? elZhTw : elZhCn));
</script>

<template>
  <el-config-provider :locale="elementLocale">
    <router-view />
  </el-config-provider>
</template>
