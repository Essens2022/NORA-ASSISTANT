import { useState } from 'preact/hooks';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { Logo } from '../../components/Logo.tsx';

type DemoTab = 'home' | 'calendar' | 'activity' | 'memory' | 'profile' | 'components' | 'notifications';

const demoTabs: Array<{ id: DemoTab; label: string; icon: IconName }> = [
  { id: 'home', label: 'Home', icon: 'spark' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'activity', label: 'Activity', icon: 'list' },
  { id: 'memory', label: 'Memory', icon: 'bookmark' },
  { id: 'profile', label: 'Profile', icon: 'user' },
  { id: 'components', label: 'UI Kit', icon: 'plus' },
  { id: 'notifications', label: 'Push', icon: 'bell' },
];

export function DesignLab() {
  const [tab, setTab] = useState<DemoTab>('home');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [voice, setVoice] = useState(false);

  return (
    <div class={`design-lab ${theme === 'light' ? 'design-lab-light' : ''}`}>
      <header class="design-lab-top">
        <div class="design-lab-brand">
          <Logo size={34} withWordmark />
          <span>Living Design System</span>
        </div>
        <button class="design-theme-toggle" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </header>

      <div class="design-lab-shell">
        <aside class="design-lab-index">
          <p class="design-kicker">NORA UI 1.0</p>
          <h1>Premium product system</h1>
          <p class="design-copy">Aceasta este sursa vizuală de adevăr. Tot ce se aprobă aici va fi implementat în aplicația reală fără reinterpretare.</p>
          <div class="design-lab-tabs">
            {demoTabs.map((item) => (
              <button type="button" class={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div class="design-token-note">
            <span>8 pt grid</span>
            <span>18–24 px radius</span>
            <span>Inter</span>
            <span>Blue → Violet</span>
          </div>
        </aside>

        <main class="design-stage">
          <div class="design-stage-head">
            <div>
              <p class="design-kicker">Interactive prototype</p>
              <h2>{demoTabs.find((x) => x.id === tab)?.label}</h2>
            </div>
            <span class="design-status"><i /> Ready for implementation</span>
          </div>

          {tab === 'home' && <HomeDemo voice={voice} onVoice={() => setVoice(!voice)} onTab={setTab} />}
          {tab === 'calendar' && <CalendarDemo />}
          {tab === 'activity' && <ActivityDemo />}
          {tab === 'memory' && <MemoryDemo />}
          {tab === 'profile' && <ProfileDemo />}
          {tab === 'components' && <ComponentsDemo />}
          {tab === 'notifications' && <NotificationDemo />}
        </main>
      </div>
    </div>
  );
}

function Phone({ children }: { children: preact.ComponentChildren }) {
  return (
    <div class="design-phone-wrap">
      <div class="design-phone">
        <div class="design-phone-status"><span>9:41</span><span>●●● 5G 82%</span></div>
        {children}
        <div class="design-home-indicator" />
      </div>
    </div>
  );
}

function DemoBottomNav({ active = 'home' }: { active?: string }) {
  return (
    <nav class="demo-bottom-nav">
      {[
        ['home', 'spark', 'NORA'],
        ['calendar', 'calendar', 'Calendar'],
        ['activity', 'list', 'Activity'],
        ['memory', 'bookmark', 'Memory'],
        ['profile', 'user', 'Profile'],
      ].map(([id, icon, label]) => (
        <button type="button" class={active === id ? 'active' : ''}>
          <Icon name={icon as IconName} size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function HomeDemo({ voice, onVoice, onTab }: { voice: boolean; onVoice: () => void; onTab: (t: DemoTab) => void }) {
  return (
    <Phone>
      <div class="demo-screen demo-home">
        <div class="demo-app-head">
          <Logo size={32} withWordmark />
          <div class="demo-avatar">N</div>
        </div>
        <div class="demo-home-hero">
          <p class="demo-eyebrow">Buon pomeriggio, Ion</p>
          <h3>Dimmi una volta.<br />Me lo ricordo io.</h3>
          <button type="button" class={`demo-orb ${voice ? 'listening' : ''}`} onClick={onVoice}>
            <span class="demo-orb-ring" />
            <Icon name={voice ? 'stop' : 'mic'} size={34} />
          </button>
          <p class="demo-orb-label">{voice ? 'Ti ascolto…' : 'Tocca e parla'}</p>
        </div>
        <div class="demo-quick-grid">
          <Quick icon="calendar" label="Calendario" onClick={() => onTab('calendar')} />
          <Quick icon="list" label="Attività" onClick={() => onTab('activity')} />
          <Quick icon="bookmark" label="Ricordi" onClick={() => onTab('memory')} />
          <Quick icon="plus" label="Nuova attività" />
        </div>
        <section class="demo-focus-card">
          <div class="demo-section-label"><Icon name="spark" size={15} /> La tua giornata</div>
          <h4>Una cosa importante adesso.</h4>
          <button type="button" class="demo-next-card">
            <span class="demo-next-time">15:42</span>
            <span class="demo-next-main"><small>ADESSO</small><strong>BEA CAFEAUA ☕️</strong><em>un tocco per aprire</em></span>
            <Icon name="chevron" size={18} />
          </button>
        </section>
        <div class="demo-composer"><span>Scrivi a NORA…</span><button type="button"><Icon name="send" size={20} /></button></div>
      </div>
      <DemoBottomNav active="home" />
    </Phone>
  );
}

function Quick({ icon, label, onClick }: { icon: IconName; label: string; onClick?: () => void }) {
  return (
    <button type="button" class="demo-quick" onClick={onClick}>
      <span><Icon name={icon} size={20} /></span>
      <small>{label}</small>
    </button>
  );
}

function CalendarDemo() {
  return (
    <Phone>
      <div class="demo-screen">
        <div class="demo-title-row"><div><p class="demo-kicker">Oggi</p><h3>Calendario</h3></div><button class="demo-round-btn" type="button"><Icon name="plus" size={20} /></button></div>
        <div class="demo-date-strip">
          {['Lun 21','Mar 22','Mer 23','Gio 24','Ven 25','Sab 26','Dom 27'].map((d,i)=><button type="button" class={i===3?'active':''}>{d}</button>)}
        </div>
        <div class="demo-agenda">
          <TimeBlock time="08:00" title="Caffè con Marco" meta="Bar Centrale" tone="blue" />
          <TimeBlock time="10:00" title="Consegna documenti" meta="Milano" tone="violet" />
          <TimeBlock time="12:00" title="Pranzo con clienti" meta="Ristorante Da Vinci" tone="orange" />
          <TimeBlock time="15:30" title="Ritirare bambino" meta="Scuola" tone="green" />
          <TimeBlock time="18:00" title="Palestra" meta="Allenamento" tone="indigo" />
        </div>
      </div>
      <DemoBottomNav active="calendar" />
    </Phone>
  );
}

function TimeBlock({ time, title, meta, tone }: { time: string; title: string; meta: string; tone: string }) {
  return <div class={`demo-time-row ${tone}`}><span>{time}</span><div><strong>{title}</strong><small>{meta}</small></div></div>;
}

function ActivityDemo() {
  return (
    <Phone>
      <div class="demo-screen">
        <div class="demo-title-row"><div><p class="demo-kicker">Focus</p><h3>Le mie attività</h3></div><button class="demo-round-btn" type="button"><Icon name="calendar" size={20}/></button></div>
        <div class="demo-segment"><button class="active">Tutte</button><button>Oggi</button><button>Programmate</button><button>Completate</button></div>
        <div class="demo-task-list">
          <TaskRow icon="check" title="Prendere le medicine" meta="Oggi · 14:00" done />
          <TaskRow icon="phone" title="Chiamare cliente" meta="Oggi · 16:30" />
          <TaskRow icon="file" title="Preparare documenti" meta="Oggi · 18:00" />
          <TaskRow icon="spark" title="Allenamento" meta="Oggi · 20:00" />
          <TaskRow icon="car" title="Noleggio furgone" meta="Domani · 09:00" />
        </div>
        <button class="demo-primary-cta" type="button"><Icon name="plus" size={18}/> Nuova attività</button>
      </div>
      <DemoBottomNav active="activity" />
    </Phone>
  );
}

function TaskRow({ icon, title, meta, done=false }: { icon: IconName; title: string; meta: string; done?: boolean }) {
  return <button type="button" class={`demo-task-row ${done?'done':''}`}><span class="demo-task-icon"><Icon name={icon} size={18}/></span><span><strong>{title}</strong><small>{meta}</small></span><Icon name="chevron" size={17}/></button>;
}

function MemoryDemo() {
  return (
    <Phone>
      <div class="demo-screen">
        <div class="demo-title-row"><div><p class="demo-kicker">Contesto</p><h3>Memory</h3></div><span class="demo-memory-count">24</span></div>
        <div class="demo-search">⌕ <span>Cerca tra i tuoi ricordi…</span></div>
        <div class="demo-segment demo-segment-short"><button class="active">Tutti</button><button>Note</button><button>Idee</button><button>Lavoro</button></div>
        <div class="demo-memory-grid">
          <MemoryCard icon="spark" title="Idee per ADB Smart" text="Nuove funzioni da implementare" />
          <MemoryCard icon="bag" title="Lista spesa" text="Pane · Latte · Frutta" />
          <MemoryCard icon="user" title="Contatti importanti" text="Clienti, fornitori, numeri utili" />
          <MemoryCard icon="bookmark" title="Progetti futuri" text="Viaggi · investimenti · obiettivi" />
        </div>
      </div>
      <DemoBottomNav active="memory" />
    </Phone>
  );
}

function MemoryCard({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return <button type="button" class="demo-memory-card"><span><Icon name={icon} size={19}/></span><div><strong>{title}</strong><small>{text}</small></div><Icon name="chevron" size={16}/></button>;
}

function ProfileDemo() {
  return (
    <Phone>
      <div class="demo-screen demo-profile">
        <div class="demo-title-row"><div><p class="demo-kicker">Account</p><h3>Profilo</h3></div></div>
        <div class="demo-profile-card"><div class="demo-avatar big">I</div><div><strong>Ion Bondari</strong><small>1 attività attiva</small></div></div>
        <SettingsGroup title="Preferenze">
          <Setting icon="list" label="Lingua" value="Italiano" />
          <Setting icon="mic" label="Voce AI" value="NORA Naturale" />
          <Setting icon="bell" label="Notifiche" value="Tutte attive" />
          <Setting icon="clock" label="Regione e ora" value="Europa/Roma" />
        </SettingsGroup>
        <SettingsGroup title="NORA">
          <Setting icon="bookmark" label="Memoria" value="Attiva" />
          <Setting icon="spark" label="Tema" value="Scuro" />
          <Setting icon="alert" label="Privacy e sicurezza" value="" />
        </SettingsGroup>
      </div>
      <DemoBottomNav active="profile" />
    </Phone>
  );
}

function SettingsGroup({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return <section class="demo-settings"><p>{title}</p><div>{children}</div></section>;
}

function Setting({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return <button type="button" class="demo-setting"><span class="demo-setting-icon"><Icon name={icon} size={18}/></span><strong>{label}</strong><small>{value}</small><Icon name="chevron" size={16}/></button>;
}

function ComponentsDemo() {
  return (
    <div class="design-components-page">
      <section><p class="design-kicker">Foundation</p><h3>Color & surface</h3><div class="design-swatches"><i/><i/><i/><i/><i/></div></section>
      <section><p class="design-kicker">Typography</p><h3>Type scale</h3><div class="design-type-ramp"><b>Display 32</b><strong>Title 24</strong><span>Body 16</span><small>Caption 12</small></div></section>
      <section><p class="design-kicker">Controls</p><h3>Buttons & fields</h3><div class="design-control-row"><button class="demo-primary-cta">Primary action</button><button class="design-secondary-btn">Secondary</button><button class="demo-round-btn"><Icon name="plus" size={20}/></button></div><div class="demo-composer design-demo-field"><span>Scrivi a NORA…</span><button><Icon name="send" size={20}/></button></div></section>
      <section><p class="design-kicker">States</p><h3>Status language</h3><div class="design-state-row"><span class="ok">Completed</span><span class="wait">Upcoming</span><span class="warn">Important</span><span class="error">Missed</span></div></section>
    </div>
  );
}

function NotificationDemo() {
  return (
    <div class="notification-spec">
      <div class="notification-copy">
        <p class="design-kicker">System notification</p>
        <h3>Zero noise. One action.</h3>
        <p>În push nu repetăm numele aplicației în conținut. Acțiunea este singurul element accentuat, iar ora rămâne secundară.</p>
        <div class="notification-rule"><span>Title</span><strong>BEA CAFEAUA ☕️</strong></div>
        <div class="notification-rule"><span>Body</span><strong>15:42</strong></div>
        <div class="notification-rule"><span>Forbidden</span><del>Ion, e momentul… / Tocca per le opzioni</del></div>
      </div>
      <div class="notification-phone">
        <div class="ios-lock"><div class="ios-time">15:42</div><div class="ios-push"><div class="ios-app-icon">N</div><div><strong>BEA CAFEAUA ☕️</strong><span>15:42</span></div><small>adesso</small></div></div>
      </div>
    </div>
  );
}
