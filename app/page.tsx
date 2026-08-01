"use client";

import { useRef, useState } from "react";
import voaLesson from "@/public/lessons/voa-listening-001/transcript.json";

type Duration = `${number}分钟` | `约${number}分钟`;

type Material = {
  id: string;
  title: string;
  duration: Duration;
  description: string;
};

const materials: Material[] = [
  {
    id: voaLesson.id,
    title: voaLesson.title,
    duration: `约${Math.round(voaLesson.duration / 60)}分钟`,
    description: voaLesson.summary,
  },
  {
    id: "sample-001",
    title: "How to Build Better Habits",
    duration: "10分钟",
    description: "通过简单可行的方法，理解习惯如何形成并产生长期改变。",
  },
  {
    id: "sample-002",
    title: "A Conversation About Creativity",
    duration: "20分钟",
    description: "一场关于创造力、失败和持续学习的深入对话。",
  },
  {
    id: "sample-003",
    title: "The Future of Clean Energy",
    duration: "10分钟",
    description: "了解清洁能源技术的发展，以及它将如何影响未来生活。",
  },
  {
    id: "sample-004",
    title: "A Day at the Office",
    duration: "30分钟",
    description: "通过自然的办公室对话，学习工作场景中的日常英语表达。",
  },
];

const steps = ["选择材料", "反复听写", "对照精学", "熟练背诵"];

function Header({ onStart }: { onStart: () => void }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <button className="brand" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <span className="brand-mark">EL</span>
          <span>ShangMethod</span>
        </button>
        <nav aria-label="主要导航">
          <button className="nav-link nav-link-active" type="button" onClick={onStart}>
            开始学习
          </button>
          <button className="nav-link" type="button">复习中心</button>
          <button className="nav-link nav-link-history" type="button">学习记录</button>
        </nav>
      </div>
    </header>
  );
}

function ProgressSteps({ activeStep = 0 }: { activeStep?: number }) {
  return (
    <ol className="progress-list" aria-label="学习流程">
      {steps.map((step, index) => (
        <li className={index === activeStep ? "progress-item is-active" : "progress-item"} key={step}>
          <span className="step-number">{index + 1}</span>
          <span className="step-name">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="filter-group">
      <p>{label}</p>
      <div className="filter-options">
        {options.map((option) => (
          <button
            type="button"
            className={selected === option ? "filter-button is-selected" : "filter-button"}
            aria-pressed={selected === option}
            onClick={() => onSelect(option)}
            key={option}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function MaterialCard({
  material,
  onChoose,
}: {
  material: Material;
  onChoose: (material: Material) => void;
}) {
  return (
    <article className="material-card">
      <div className="material-meta">
        <span>{material.duration}</span>
      </div>
      <h3>{material.title}</h3>
      <p>{material.description}</p>
      <button className="card-button" type="button" onClick={() => onChoose(material)}>
        采用这篇
        <span aria-hidden="true">→</span>
      </button>
    </article>
  );
}

function PreparationView({
  material,
  onBack,
}: {
  material: Material;
  onBack: () => void;
}) {
  return (
    <main className="preparation-page">
      <div className="preparation-shell">
        <button type="button" className="back-button" onClick={onBack}>
          <span aria-hidden="true">←</span> 返回选择材料
        </button>

        <div className="preparation-heading">
          <p className="eyebrow">学习准备</p>
          <h1>准备好，真正听懂这一篇</h1>
          <p>确认材料信息后，我们将从反复听写开始。</p>
        </div>

        <section className="preparation-progress" aria-label="学习进度">
          <ProgressSteps activeStep={0} />
        </section>

        <section className="chosen-material">
          <div>
            <p className="chosen-label">已选择材料</p>
            <h2>{material.title}</h2>
            <p className="chosen-description">{material.description}</p>
            <div className="chosen-tags">
              <span>{material.duration}</span>
            </div>
          </div>
          <div className="ready-action">
            <p>下一步</p>
            <button type="button" className="primary-button">
              开始反复听写
              <span aria-hidden="true">→</span>
            </button>
            <small>听写功能将在下一阶段开放</small>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function Home() {
  const materialsRef = useRef<HTMLElement>(null);
  const [duration, setDuration] = useState<Duration>("约7分钟");
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const filteredMaterials = materials.filter(
    (material) => material.duration === duration,
  );

  const scrollToMaterials = () => {
    materialsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (selectedMaterial) {
    return (
      <>
        <Header onStart={() => setSelectedMaterial(null)} />
        <PreparationView material={selectedMaterial} onBack={() => setSelectedMaterial(null)} />
      </>
    );
  }

  return (
    <>
      <Header onStart={scrollToMaterials} />
      <main>
        <section className="hero">
          <div className="hero-inner">
            <div className="hero-copy">
              <p className="eyebrow">ShangMethod</p>
              <h1>三个月重塑真正的语言本能</h1>
              <p className="hero-description">
                这里没有轻松的捷径，只有真刀真枪的蜕变。
              </p>
              <button className="primary-button" type="button" onClick={scrollToMaterials}>
                开始今日学习
                <span aria-hidden="true">↓</span>
              </button>
            </div>
          </div>
        </section>

        <section className="process-section">
          <div className="section-shell">
            <div className="section-intro">
              <div>
                <p className="eyebrow">学习路径</p>
                <h2>一次完整、扎实的学习循环</h2>
              </div>
              <p>当前位于第一步：先选一篇适合今天状态的材料。</p>
            </div>
            <ProgressSteps activeStep={0} />
          </div>
        </section>

        <section className="materials-section" ref={materialsRef}>
          <div className="section-shell">
            <div className="materials-heading">
              <div>
                <p className="eyebrow">第一步 · 选择材料</p>
                <h2>今天想听什么？</h2>
              </div>
              <p>选择音频时长，找到适合今天状态的材料。</p>
            </div>

            <div className="materials-workspace">
              <aside className="filter-panel" aria-label="材料筛选">
                <FilterGroup
                  label="音频时长"
                  options={["约7分钟", "10分钟", "20分钟", "30分钟"] as const}
                  selected={duration}
                  onSelect={setDuration}
                />
              </aside>

              <div className="results-panel">
                <div className="results-summary" aria-live="polite">
                  <div>
                    <span>{duration}</span>
                  </div>
                  <p>{filteredMaterials.length}篇材料</p>
                </div>

                <div className="materials-grid">
                  {filteredMaterials.map((material) => (
                    <MaterialCard
                      material={material}
                      onChoose={setSelectedMaterial}
                      key={material.id}
                    />
                  ))}
                </div>

                {filteredMaterials.length === 0 && (
                  <div className="empty-results">
                    <span>暂无匹配材料</span>
                    <p>这个组合的示例材料还在准备中，请换一个时长或分类。</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="footer-inner">
          <div>
            <strong>ShangMethod</strong>
            <span>ShangMethod</span>
          </div>
          <p>认真听，反复练，让英语成为本能。</p>
        </div>
      </footer>
    </>
  );
}
