<!-- config/ConfigSectionRenderer.vue — 分组 + 高级折叠 + 搜索（照 AstrBotConfigV4 容器）。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, ref } from 'vue';
import { splitBasicAdvanced, filterItems, type ConfigItemMeta } from '@openpet/protocol';
import ConfigItemRenderer from './ConfigItemRenderer.vue';

const { t } = useI18n();
const props = defineProps<{
  items: ConfigItemMeta[];
  modelValue: Record<string, unknown>;
  searchable?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [Record<string, unknown>] }>();

const query = ref('');
const showAdvanced = ref(false);
const visible = computed(() => filterItems(props.items, query.value));
const groups = computed(() => splitBasicAdvanced(visible.value));
// 搜索非空时强制展开高级命中项（照 AstrBot）。
const expanded = computed(() => (query.value.trim() ? true : showAdvanced.value));

function set(key: string, val: unknown): void {
  emit('update:modelValue', { ...props.modelValue, [key]: val });
}
</script>
<template>
  <div class="grid gap-3">
    <input
      v-if="searchable"
      v-model="query"
      class="ds-control rounded-input px-3 py-2 text-sm text-text-main"
      :placeholder="t('settings.config.searchPlaceholder')"
    />

    <label v-for="item in groups.basic" :key="item.key" class="block">
      <span class="text-sm text-text-sub">{{ item.label ?? item.key }}</span>
      <ConfigItemRenderer
        class="mt-1 block"
        :meta="item"
        :model-value="modelValue[item.key]"
        @update:model-value="(v) => set(item.key, v)"
      />
      <span v-if="item.hint" class="mt-1 block text-xs text-text-sub">{{ item.hint }}</span>
    </label>

    <div v-if="groups.advanced.length" class="grid gap-2">
      <button
        class="w-fit text-left text-sm text-text-sub underline"
        @click="showAdvanced = !showAdvanced"
      >
        {{ expanded ? t('settings.config.collapseAdvanced') : t('settings.config.advanced') }}
      </button>
      <template v-if="expanded">
        <label v-for="item in groups.advanced" :key="item.key" class="block">
          <span class="text-sm text-text-sub">{{ item.label ?? item.key }}</span>
          <ConfigItemRenderer
            class="mt-1 block"
            :meta="item"
            :model-value="modelValue[item.key]"
            @update:model-value="(v) => set(item.key, v)"
          />
          <span v-if="item.hint" class="mt-1 block text-xs text-text-sub">{{ item.hint }}</span>
        </label>
      </template>
    </div>
  </div>
</template>
