<script setup>
import { computed } from 'vue'
import { useData, useRoute } from 'vitepress'

const { lang } = useData()
const route = useRoute()

const logoSrc = 'https://www.autoc-tool.com/logo1.png'

const isZh = computed(() => lang.value === 'zh-Hans' || route.path.startsWith('/zh'))

const copy = computed(() =>
  isZh.value
    ? {
        desc: 'AUTOSAR BSW 配置 AI 助手：用自然语言改参、计算与校验，多轮迭代直至通过。',
        cta: '了解更多'
      }
    : {
        desc: 'AUTOSAR BSW AI assistant: natural-language config, validation, and iterative fixes in your project.',
        cta: 'Learn more'
      }
)
</script>

<template>
  <a
    class="autoc-aside"
    href="https://www.autoc-tool.com/"
    target="_blank"
    rel="noopener noreferrer"
  >
    <div class="autoc-aside-head">
      <img class="autoc-aside-logo" :src="logoSrc" alt="" />
      <span class="autoc-aside-name">AutoC</span>
    </div>
    <p class="autoc-aside-desc">{{ copy.desc }}</p>
    <span class="autoc-aside-cta">{{ copy.cta }} →</span>
  </a>
</template>

<style scoped>
.autoc-aside {
  display: block;
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  text-decoration: none;
  color: inherit;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.autoc-aside:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.autoc-aside-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.autoc-aside-logo {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.autoc-aside-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--vp-c-brand-1);
  line-height: 1.2;
}

.autoc-aside-desc {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
  text-align: left;
}

.autoc-aside-cta {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}
</style>
