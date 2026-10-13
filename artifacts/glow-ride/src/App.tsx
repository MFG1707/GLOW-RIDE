import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ArrowLeft, ArrowRight, ArrowUpRight, Bike, CalendarDays, Check, Clock3, Gauge, MapPin, Menu, Minus, Plus, ShieldCheck, X } from 'lucide-react';
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation, useRoute } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  getGetAdminOverviewQueryKey, getGetAdminSettingsQueryKey, getGetAvailabilityQueryKey,
  getGetMyProfileQueryKey, getGetMyReservationQueryKey, getGetPublicSettingsQueryKey, getListAdminLocationsQueryKey,
  getListAdminReservationsQueryKey, getListAdminSessionsQueryKey, getListAdminUsersQueryKey,
  getListMyReservationsQueryKey, getListSessionsQueryKey, useCancelMyReservation,
  useCreateCheckout, useCreateLocation, useCreateReservation, useCreateSession,
  useDeleteLocation, useDeleteSession, useGetAdminOverview, useGetAdminSettings, useGetMyProfile,
  useGetAvailability, useGetMyReservation, useGetPublicSettings, useListAdminLocations,
  useListAdminReservations, useListAdminSessions, useListAdminUsers, useListMyReservations,
  useListSessions, useUpdateAdminReservation, useUpdateAdminSettings, useUpdateAdminUserRole,
  useUpdateLocation, useUpdateSession
} from '@workspace/api-client-react';
import type { Reservation } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
const clerkAppearance = {
  theme: shadcn, cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: { colorPrimary: '#ed1017', colorForeground: '#f5f5f5', colorMutedForeground: '#888888', colorDanger: '#ff4b50', colorBackground: '#151515', colorInput: '#090909', colorInputForeground: '#f5f5f5', colorNeutral: '#393939', fontFamily: 'DM Sans', borderRadius: '0.7rem' },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#151515] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#303030]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-white font-semibold', headerSubtitle: 'text-[#999]', socialButtonsBlockButtonText: 'text-white',
    formFieldLabel: 'text-[#c3c3c3]', footerActionLink: 'text-[#ff252b]', footerActionText: 'text-[#888]',
    dividerText: 'text-[#888]', identityPreviewEditButton: 'text-[#ff252b]', formFieldSuccessText: 'text-emerald-400',
    alertText: 'text-white', logoBox: 'h-10', logoImage: 'h-8', socialButtonsBlockButton: 'border-[#393939] text-white',
    formButtonPrimary: 'bg-[#ed1017] hover:bg-[#ff292f] text-white', formFieldInput: 'bg-[#090909] border-[#3a3a3a] text-white',
    footerAction: 'text-[#888]', dividerLine: 'bg-[#393939]', alert: 'border-[#393939] bg-[#202020]',
    otpCodeFieldInput: 'bg-[#090909] border-[#393939] text-white', formFieldRow: 'text-white', main: 'text-white'
  }
};
const money = (amount = 0) => `${new Intl.NumberFormat('fr-FR').format(amount)} F`;
const dateLabel = (date: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) =>
  new Intl.DateTimeFormat('fr-FR', options).format(new Date(`${date}T12:00:00`));
const shortDate = (date: string) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(`${date}T12:00:00`));
const timeOptions = (session?: { opensAt: string; closesAt: string }) => {
  if (!session) return [];
  const [oh, om] = session.opensAt.split(':').map(Number), [ch, cm] = session.closesAt.split(':').map(Number);
  const slots: string[] = [];
  for (let t = oh * 60 + om; t < ch * 60 + cm; t += 60) slots.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  return slots;
};
const durationName = (minutes: number) => minutes < 60 ? `${minutes} min` : minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} ${minutes === 60 ? 'heure' : 'heures'}`;

function Brand({ small = false }: { small?: boolean }) {
  return <Link href="/" className={`brand ${small ? 'brand-small' : ''}`} data-testid="link-home"><span className="brand-mark"><i /><i /><i /></span><span>GLOW<span className="brand-red">-</span>RIDE</span></Link>;
}
function Footer() { return <footer className="site-footer"><Brand small /><span>Produit par MFG-TECH</span></footer>; }
function Header({ admin = false }: { admin?: boolean }) {
  const [open, setOpen] = useState(false);
  const { signOut } = useClerk();
  return <header className="topbar"><Brand /><nav className={`main-nav ${open ? 'nav-open' : ''}`}>
    {admin ? <><Link href="/admin" data-testid="link-admin-overview">Vue d’ensemble</Link><Link href="/admin/sessions" data-testid="link-admin-sessions">Sessions</Link><Link href="/admin/locations" data-testid="link-admin-locations">Lieux</Link><Link href="/admin/reservations" data-testid="link-admin-reservations">Réservations</Link><Link href="/admin/settings" data-testid="link-admin-settings">Tarifs</Link><Link href="/admin/users" data-testid="link-admin-users">Utilisateurs</Link></> :
      <><Link href="/reserve" data-testid="link-nav-book">Réserver</Link><Link href="/account/reservations" data-testid="link-nav-bookings">Mes réservations</Link><Show when="signed-in"><ProfileNav /><button onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-signout">Déconnexion</button></Show><Show when="signed-out"><Link href="/sign-in" data-testid="link-signin">Connexion</Link></Show></>}
  </nav><button className="mobile-menu" aria-label="Menu" onClick={() => setOpen(!open)} data-testid="button-menu">{open ? <X /> : <Menu />}</button></header>;
}
function Shell({ children, admin = false }: { children: ReactNode; admin?: boolean }) { return <div className="app-shell"><Header admin={admin} /><main>{children}</main><Footer /></div>; }
function Loading({ label = 'Chargement des disponibilités…' }: { label?: string }) { return <div className="loading-panel" data-testid="status-loading"><span className="skeleton-line" /><span className="skeleton-line short" /><span>{label}</span></div>; }
function ErrorPanel({ retry, text = 'Un problème est survenu. Réessayez dans un instant.' }: { retry?: () => void; text?: string }) { return <div className="notice error-notice" role="alert" data-testid="status-error"><span>{text}</span>{retry && <button onClick={retry} data-testid="button-retry">Réessayer</button>}</div>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty-state" data-testid="state-empty"><div className="empty-icon"><Bike size={24} /></div><strong>{title}</strong><p>{detail}</p></div>; }
function BrandAuth() { return <div className="auth-page"><Brand /><div className="auth-intro"><span className="eyebrow">GLOW-RIDE · COMPTE RIDER</span><h1>La ville est à vous.</h1><p>Connectez-vous pour retrouver vos réservations et suivre votre prochain départ.</p></div><Switch><Route path="/sign-in/*?"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></Route><Route path="/sign-up/*?"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></Route></Switch><Footer /></div>; }
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk(), qc = useQueryClient(), previous = useRef<string | null | undefined>(undefined);
  useEffect(() => { const unsub = addListener(({ user }) => { const id = user?.id ?? null; if (previous.current !== undefined && previous.current !== id) qc.clear(); previous.current = id; }); return unsub; }, [addListener, qc]);
  return null;
}
function ProviderRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Bon retour', subtitle: 'Connectez-vous pour retrouver vos réservations' } }, signUp: { start: { title: 'Rejoignez Glow Ride', subtitle: 'Créez votre compte rider' } } }}
    routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><ClerkQueryClientCacheInvalidator />
      <ErrorBoundary resetKey={window.location.pathname}><Switch>
        <Route path="/" component={HomeGate} />
        <Route path="/reserve" component={ReservePage} /><Route path="/reserve/review" component={ReviewPage} /><Route path="/reserve/confirmation" component={ConfirmationPage} />
        <Route path="/account/reservations" component={MyReservationsPage} /><Route path="/account/reservations/:id" component={ReservationDetailPage} />
        <Route path="/admin" component={GuardedAdminOverview} /><Route path="/admin/sessions" component={GuardedAdminSessions} />
        <Route path="/admin/locations" component={GuardedAdminLocations} /><Route path="/admin/reservations" component={GuardedAdminReservations} />
        <Route path="/admin/settings" component={GuardedAdminSettings} /><Route path="/admin/users" component={GuardedAdminUsers} />
        <Route path="/sign-in/*?" component={AuthFrame} /><Route path="/sign-up/*?" component={AuthFrame} />
        <Route component={BrandedNotFound} />
      </Switch></ErrorBoundary><Toaster /></QueryClientProvider>
  </ClerkProvider>;
}
function AuthFrame() { return <div className="auth-frame"><div className="auth-branding"><Brand /><div><span className="eyebrow">MOBILITÉ, SANS DÉTOUR</span><h1>Un départ.<br />Votre rythme.</h1><p>Retrouvez votre réservation, votre créneau et le rendez-vous du jour.</p></div></div><div className="auth-form"><Switch><Route path="/sign-in/*?"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></Route><Route path="/sign-up/*?"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></Route></Switch></div><Footer /></div>; }
function BrandedNotFound() { return <Shell><div className="empty-route"><span className="eyebrow red-text">404 / PAS DE SESSION ICI</span><h1>Cette page a raté son rendez-vous.</h1><p>Le lien a peut-être bougé. Reprenez le parcours depuis le calendrier Glow Ride.</p><Link href="/reserve" className="button-primary" data-testid="link-not-found-book">Trouver une session <ArrowRight size={16}/></Link></div></Shell>; }
function HomeGate() { return <><Show when="signed-in"><SignedInHomeRedirect /></Show><Show when="signed-out"><HomePage /></Show></>; }
function SignedInHomeRedirect() {
  const profile = useGetMyProfile({ query: { queryKey: getGetMyProfileQueryKey() } });
  if (profile.isLoading) return <Shell><Loading label="Ouverture de votre espace…"/></Shell>;
  if (profile.isError) return <Shell><ErrorPanel text="Impossible de charger votre profil. Réessayez." retry={() => profile.refetch()}/></Shell>;
  return <Redirect to={profile.data?.role === 'admin' ? '/admin' : '/account/reservations'} />;
}
function ProfileNav() {
  const profile = useGetMyProfile({ query: { queryKey: getGetMyProfileQueryKey() } });
  return <span className="profile-nav" data-testid="text-account-role">{profile.data ? `${profile.data.fullName || profile.data.email} · ${profile.data.role === 'admin' ? 'Admin' : 'Rider'}` : 'Compte rider'}</span>;
}

function HomePage() {
  const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);
  const sessionsQ = useListSessions({ from, to });
  const sessions = sessionsQ.data ?? [];
  return <Shell><section className="hero">
    <div className="hero-copy"><span className="eyebrow"><span className="live-dot" /> LA VILLE BOUGE. NOUS AUSSI.</span><h1>Réservez votre<br />trottinette, où que<br />nous soyons<span className="red-period">.</span></h1><p>Choisissez votre date. On vous indique le lieu du jour, le créneau et les trottinettes disponibles. Simple, rapide, carré.</p><Link href="/reserve" className="button-primary hero-action" data-testid="button-start-booking">Trouver mon créneau <ArrowRight size={18} /></Link><div className="hero-assurance"><ShieldCheck size={16} /> Disponibilité en temps réel <span /> Réservation sécurisée</div></div>
    <div className="hero-art" aria-label="Illustration abstraite d’une trottinette urbaine"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-stamp">RIDE<br />YOUR<br />CITY</div><div className="scooter-art"><div className="wheel wheel-a" /><div className="wheel wheel-b" /><div className="scooter-deck" /><div className="scooter-stem" /><div className="scooter-handle" /></div><div className="art-caption"><span>01 / MOBILE PAR NATURE</span><span>COTONOU — CALAVI — OUIDAH</span></div></div>
  </section>
  <section className="ticker"><div className="ticker-track"><span>CHOISISSEZ</span><i /> <span>VÉRIFIEZ</span><i /> <span>RÉSERVEZ</span><i /> <span>ROULEZ</span><i /> <span>CHOISISSEZ</span><i /> <span>VÉRIFIEZ</span><i /> <span>RÉSERVEZ</span></div></section>
  <section className="section next-sessions"><div className="section-heading"><div><span className="eyebrow">LE PROCHAIN DÉPART</span><h2>Glow Ride, <em>en mouvement.</em></h2><p>Le lieu change avec le calendrier. Voici les prochaines dates publiées.</p></div><Link href="/reserve" className="text-link" data-testid="link-all-sessions">Voir les disponibilités <ArrowUpRight size={16} /></Link></div>
    {sessionsQ.isLoading ? <div className="session-grid"><Loading /></div> : sessionsQ.isError ? <ErrorPanel retry={() => sessionsQ.refetch()} /> : sessions.length ? <div className="session-grid">{sessions.slice(0, 3).map((s, i) => <Link href={`/reserve?date=${s.date}`} className={`session-card session-card-${i}`} key={s.id} data-testid={`card-session-${s.id}`}><div className="session-card-top"><span className="session-index">0{i + 1}</span><span className="live-label"><i /> EN ACTIVITÉ</span></div><span className="session-date">{shortDate(s.date)}</span><h3>{s.city}</h3><p><MapPin size={14} /> {s.locationName}</p><div className="session-card-bottom"><span>{s.opensAt} — {s.closesAt}</span><span>{s.scooterCount} véhicules <ArrowUpRight size={14} /></span></div></Link>)}</div> : <Empty title="Le calendrier se prépare." detail="Aucune session publiée pour le moment. Revenez bientôt pour voir où nous retrouver." />}
  </section>
  <section className="steps-section"><div className="section-heading"><div><span className="eyebrow">QUATRE GESTES, UNE VIRÉE</span><h2>Votre ride, <em>sans détour.</em></h2></div><span className="section-note">Le bon endroit.<br />Au bon moment.</span></div><div className="steps-list">{[['01','Choisissez une date','On vous montre uniquement les journées où Glow Ride est actif.'],['02','Découvrez le lieu du jour','Ville, adresse et point de rendez-vous sont liés à cette session.'],['03','Sélectionnez votre créneau','Durée, heure et quantité selon le stock en temps réel.'],['04','Validez votre réservation','Un récapitulatif clair, puis votre départ est calé.']].map(([n,t,d])=><article className="step-row" key={n}><span className="step-no">{n}</span><h3>{t}</h3><p>{d}</p><ArrowUpRight size={18} /></article>)}</div></section>
  <section className="moving-section"><div className="moving-visual"><span className="eyebrow">PAS DE STATION FIXE. JAMAIS.</span><div className="route-line"><span /><i /><span /><i /><span /></div><div className="city-labels"><div><strong>Cotonou</strong><small>Fidjrossè</small></div><div><strong>Calavi</strong><small>Centre-ville</small></div><div><strong>Ouidah</strong><small>Prochaine escale</small></div></div><div className="map-coordinates">06°21′N&nbsp;&nbsp; 02°25′E <span>POSITION : DATE DÉPENDANTE</span></div></div><div className="moving-copy"><span className="eyebrow">UN SERVICE QUI SE DÉPLACE</span><h2>Votre ville<br />est notre <em>prochaine.</em></h2><p>Glow Ride suit le rythme des journées, des rassemblements et des quartiers. Chaque session annonce son propre lieu de rendez-vous — on vous y attend.</p><Link href="/reserve" className="button-outline" data-testid="button-discover-dates">Explorer les dates <ArrowRight size={16} /></Link></div></section>
  <section className="final-cta"><span className="eyebrow">UNE DATE VOUS TENTE ?</span><h2>La ville change.<br /><em>Votre plan est prêt.</em></h2><Link href="/reserve" className="button-primary" data-testid="button-final-booking">Réserver ma trottinette <ArrowRight size={17} /></Link><span className="cta-decoration">GLOW<br />RIDE</span></section>
  </Shell>;
}

type Selection = { sessionId: string; date: string; startTime: string; durationMinutes: number; scooterCount: number; priceXof?: number };
const selectionKey = 'glowride-selection', reservationKey = 'glowride-reservation';
function setSelection(v: Selection) { sessionStorage.setItem(selectionKey, JSON.stringify(v)); }
function getSelection(): Selection | null { try { return JSON.parse(sessionStorage.getItem(selectionKey) || 'null'); } catch { return null; } }
function useBookingData() {
  const [date, setDate] = useState(new URLSearchParams(window.location.search).get('date') || new Date().toISOString().slice(0, 10));
  const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const sessionsQ = useListSessions({ from, to });
  const matching = (sessionsQ.data ?? []).filter(s => s.date === date && s.active);
  const [sessionId, setSessionId] = useState('');
  const session = matching.find(s => s.id === sessionId) ?? matching[0];
  useEffect(() => {
    const availableDates = (sessionsQ.data ?? []).filter(s => s.active).map(s => s.date).sort();
    if (sessionsQ.data && availableDates.length && !availableDates.includes(date)) setDate(availableDates[0]);
    if (!matching.some(s => s.id === sessionId)) setSessionId(matching[0]?.id ?? '');
  }, [date, sessionsQ.data]);
  const [startTime, setStartTime] = useState('');
  const [duration, setDuration] = useState(60), [quantity, setQuantity] = useState(1);
  const hours = timeOptions(session);
  useEffect(() => { if (!hours.includes(startTime)) setStartTime(hours[0] ?? ''); }, [session?.id, hours.join('|')]);
  const durations = session?.durationsMinutes ?? [];
  useEffect(() => { if (!durations.includes(duration) && durations.length) setDuration(durations[0]); }, [session?.id, durations.join('|')]);
  const availabilityParams = { sessionId: session?.id ?? '', startTime, durationMinutes: duration, quantity };
  const availabilityQ = useGetAvailability(availabilityParams, { query: { enabled: !!session?.id && !!startTime && durations.includes(duration), queryKey: getGetAvailabilityQueryKey(availabilityParams) } });
  return { date, setDate, sessionsQ, matching, session, setSessionId, startTime, setStartTime, duration, setDuration, quantity, setQuantity, hours, durations, availabilityQ };
}
function Progress({ step }: { step: number }) { return <div className="progress-row"><Brand small /><div className="step-progress"><span>ÉTAPE {step} / 2</span><i><b style={{ transform: `scaleX(${step / 2})` }} /></i></div></div>; }
function BookingBar({ selection, price, label, onClick }: { selection: Selection; price?: number; label: string; onClick: () => void }) { return <div className="booking-bar"><div><small>{dateLabel(selection.date)} · {durationName(selection.durationMinutes)}</small><strong>{price === undefined ? '—' : money(price)}</strong></div><button onClick={onClick} className="button-primary" data-testid="button-booking-continue">{label}<ArrowRight size={17} /></button></div>; }
function ReservePage() {
  const [, setLocation] = useLocation(), book = useBookingData();
  const { session, date, setDate, matching, sessionsQ, hours, durations, startTime, setStartTime, duration, setDuration, quantity, setQuantity, availabilityQ } = book;
  const avail = availabilityQ.data;
  const price = avail?.priceXof;
  const selectAndContinue = () => { if (!session || !startTime || !avail?.available) return; setSelection({ sessionId: session.id, date, startTime, durationMinutes: duration, scooterCount: quantity, priceXof: price }); setLocation('/reserve/review'); };
  const dates = useMemo(() => [...new Set((sessionsQ.data ?? []).filter(s => s.active).map(s => s.date))].sort(), [sessionsQ.data]);
  return <Shell><div className="booking-page"><Progress step={1} /><div className="booking-heading"><span className="eyebrow red-text">RÉSERVATION</span><h1>Composez votre<br /><em>session.</em></h1><p>Chaque choix filtre le suivant.</p></div>
    {sessionsQ.isLoading ? <Loading /> : sessionsQ.isError ? <ErrorPanel retry={() => sessionsQ.refetch()} /> : <div className="booking-layout"><div className="booking-main">
      <section className="booking-panel"><div className="panel-title"><span className="number-chip">01</span><div><h2>Choisissez une date</h2><p>Seuls les jours en activité</p></div><CalendarDays size={19} /></div>
        {!dates.length ? <div className="inline-empty">Aucune date publiée. Revenez bientôt.</div> : <div className="date-strip">{dates.map(d=><button key={d} className={`date-option ${date === d ? 'selected' : ''}`} onClick={()=>setDate(d)} data-testid={`button-date-${d}`}><small>{new Intl.DateTimeFormat('fr-FR',{weekday:'short'}).format(new Date(`${d}T12:00:00`)).replace('.','')}</small><strong>{new Intl.DateTimeFormat('fr-FR',{day:'2-digit'}).format(new Date(`${d}T12:00:00`))}</strong><small>{new Intl.DateTimeFormat('fr-FR',{month:'short'}).format(new Date(`${d}T12:00:00`)).replace('.','')}</small></button>)}</div>}
      </section>
      <section className="booking-panel"><div className="panel-title"><span className="number-chip">02</span><div><h2>Le lieu du jour</h2><p>Lié à la date sélectionnée</p></div><MapPin size={19} /></div>
        {matching.length ? <div className="location-choice">{matching.map(s=><button className={`location-card ${session?.id === s.id ? 'selected' : ''}`} key={s.id} onClick={()=>book.setSessionId(s.id)} data-testid={`button-location-${s.id}`}><i /><span><strong>{s.city} · {s.locationName}</strong><small>{s.address}</small><small>Rendez-vous : {s.meetingPoint}</small></span><Check size={17} /></button>)}</div> : <div className="inline-empty">Pas de session pour cette date. Choisissez une autre journée.</div>}
      </section>
      <section className="booking-panel"><div className="panel-title"><span className="number-chip">03</span><div><h2>Choisissez un horaire</h2><p>Les créneaux complets sont désactivés</p></div><Clock3 size={19} /></div><div className="choice-chips">{hours.map(t=><button key={t} className={`choice-chip ${startTime===t?'selected':''}`} onClick={()=>setStartTime(t)} data-testid={`button-time-${t}`}>{t} – {`${String((Number(t.slice(0,2))+1)%24).padStart(2,'0')}:${t.slice(3)}`}</button>)}</div></section>
      <section className="booking-panel"><div className="panel-title"><span className="number-chip">04</span><div><h2>Choisissez une durée</h2><p>Limitée par le créneau</p></div><Gauge size={19} /></div><div className="choice-chips">{durations.map(d=><button key={d} className={`choice-chip ${duration===d?'selected':''}`} onClick={()=>setDuration(d)} data-testid={`button-duration-${d}`}>{durationName(d)}</button>)}</div><small className="helper-line">Tarif calculé selon la durée.</small></section>
      <section className="booking-panel"><div className="panel-title"><span className="number-chip">05</span><div><h2>Combien de trottinettes ?</h2><p>Limité par le stock du créneau</p></div><Bike size={19} /></div><div className="quantity-control"><button disabled={quantity <= 1} onClick={()=>setQuantity(Math.max(1,quantity-1))} aria-label="Retirer une trottinette" data-testid="button-quantity-minus"><Minus size={16}/></button><strong data-testid="text-quantity">{quantity}</strong><button disabled={quantity >= Math.min(20,avail?.availableScooters ?? 20)} onClick={()=>setQuantity(quantity+1)} aria-label="Ajouter une trottinette" data-testid="button-quantity-plus"><Plus size={16}/></button><span>sur {avail?.availableScooters ?? '—'}</span></div>
      </section>
      {availabilityQ.isLoading && session && <div className="availability-line"><span className="pulse-dot" /> Vérification du stock…</div>}
      {availabilityQ.isError && <ErrorPanel retry={()=>availabilityQ.refetch()} text="Impossible de vérifier le stock." />}
      {avail && <div className={`availability-line ${avail.available ? 'available' : 'unavailable'}`} data-testid="status-availability"><span className="pulse-dot" />{avail.available ? `${avail.availableScooters} trottinettes disponibles sur ce créneau` : `Plus assez de véhicules pour cette quantité (${avail.availableScooters} disponible${avail.availableScooters > 1 ? 's' : ''})`}</div>}
    </div><aside className="booking-summary"><span className="eyebrow">VOTRE SESSION</span><div className="summary-place"><MapPin size={18}/><strong>{session ? `${session.city} · ${session.locationName}` : 'Sélectionnez une date'}</strong></div><div className="summary-row"><span>Date</span><strong>{session ? dateLabel(session.date) : '—'}</strong></div><div className="summary-row"><span>Horaire</span><strong>{startTime || '—'}</strong></div><div className="summary-row"><span>Durée</span><strong>{durationName(duration)}</strong></div><div className="summary-row"><span>Véhicules</span><strong>{quantity}</strong></div><div className="summary-total"><span>Estimation</span><strong>{price === undefined ? '—' : money(price)}</strong></div><small>Montant final calculé par Glow Ride avant validation.</small><button onClick={selectAndContinue} className="button-primary full" disabled={!session || !avail?.available} data-testid="button-review-selection">Continuer <ArrowRight size={16}/></button></aside></div>}
  </div></Shell>;
}

function SessionRecap({ selection }: { selection: Selection }) {
  const sessionsQ = useListSessions({ from: selection.date, to: selection.date });
  const session = sessionsQ.data?.find(s=>s.id===selection.sessionId);
  return <div className="recap-card"><h2>Votre session</h2><div className="summary-row"><span>Date</span><strong>{dateLabel(selection.date)}</strong></div><div className="summary-row"><span>Lieu</span><strong>{session ? `${session.city} · ${session.locationName}` : 'Chargement…'}</strong></div><div className="summary-row"><span>Horaire</span><strong>{selection.startTime}</strong></div><div className="summary-row"><span>Durée</span><strong>{durationName(selection.durationMinutes)}</strong></div><div className="summary-row"><span>Trottinettes</span><strong>{selection.scooterCount}</strong></div>{session&&<><div className="recap-divider"/><span className="eyebrow">POINT DE RENDEZ-VOUS</span><p className="meeting-detail">{session.meetingPoint}</p><small>{session.address}</small></>}</div>;
}
function ReviewPage() {
  const [, setLocation] = useLocation(); const [selection] = useState(getSelection); const qc = useQueryClient();
  const create = useCreateReservation();
  const reserve = () => { if (!selection) return; create.mutate({ data: { sessionId: selection.sessionId, startTime: selection.startTime, durationMinutes: selection.durationMinutes, scooterCount: selection.scooterCount } }, { onSuccess: (reservation) => { qc.invalidateQueries({queryKey:getListMyReservationsQueryKey()}); qc.invalidateQueries({queryKey:getGetMyReservationQueryKey(reservation.id)}); qc.invalidateQueries({queryKey:getGetAvailabilityQueryKey()}); sessionStorage.setItem(reservationKey, reservation.id); setLocation(`/reserve/confirmation?id=${encodeURIComponent(reservation.id)}`); }, onError: () => {} }); };
  if (!selection) return <Shell><div className="empty-route"><Empty title="Votre sélection a expiré." detail="Recommencez la réservation pour choisir une session disponible."/><Link href="/reserve" className="button-primary" data-testid="link-return-booking">Choisir une session</Link></div></Shell>;
  return <Shell><div className="booking-page"><Progress step={2}/><Link href="/reserve" className="back-link" data-testid="link-edit-selection"><ArrowLeft size={15}/> Modifier ma sélection</Link><div className="booking-heading"><span className="eyebrow red-text">RÉCAPITULATIF</span><h1>Vérifiez avant<br /><em>de valider.</em></h1><p>Encore un instant, votre créneau est presque réservé.</p></div><div className="review-layout"><div><SessionRecap selection={selection}/><div className="reassurance-card"><ShieldCheck/><div><strong>Créneau vérifié à la réservation</strong><p>La réservation sera créée sur les disponibilités communiquées pour cette session.</p></div></div></div><aside className="booking-summary review-payment"><span className="eyebrow">TOTAL DE LA SESSION</span><strong className="review-price">{selection.priceXof === undefined ? 'Calculé à la validation' : money(selection.priceXof)}</strong><p>Le règlement se poursuit à l’étape suivante avec le moyen de paiement proposé.</p>{create.isError&&<ErrorPanel text="La réservation n’a pas pu être créée. Vérifiez la disponibilité et réessayez."/>}<button onClick={reserve} disabled={create.isPending} className="button-primary full" data-testid="button-confirm-booking">{create.isPending ? 'Validation…' : 'Valider ma réservation'} <ArrowRight size={16}/></button><small>La disponibilité est confirmée par le serveur.</small></aside></div></div></Shell>;
}
function ConfirmationPage() {
  const [, setLocation] = useLocation(), params = new URLSearchParams(window.location.search);
  const id = params.get('id') || sessionStorage.getItem(reservationKey) || '';
  const reservationQ = useGetMyReservation(id, { query: { enabled: !!id, queryKey: getGetMyReservationQueryKey(id) } });
  const checkout = useCreateCheckout();
  const settingsQ = useGetPublicSettings();
  const [method,setMethod] = useState<'mtn_momo'|'moov_money'>('mtn_momo'), [phone,setPhone] = useState('');
  const reservation = reservationQ.data;
  const pay = () => { if (!reservation) return; checkout.mutate({ id: reservation.id, data: { paymentMethod: method, phoneNumber: phone } }, { onSuccess: result => { if (result.redirectUrl) window.location.assign(result.redirectUrl); } }); };
  return <Shell><div className="confirmation-page"><div className="confirmed-mark"><Check size={29}/></div><span className="eyebrow green-text">RÉSERVATION CRÉÉE</span><h1>{reservation?.bookingStatus === 'confirmed' ? 'Réservation confirmée' : 'Votre départ est presque calé.'}</h1><p className="confirm-lede">{reservation?.paymentStatus === 'paid' ? 'Votre paiement est confirmé.' : 'Choisissez votre moyen de paiement pour confirmer votre réservation.'}</p>
    {reservationQ.isLoading && <Loading label="Récupération du récapitulatif…"/>}{reservationQ.isError && <ErrorPanel retry={()=>reservationQ.refetch()} text="La réservation n’a pas pu être chargée. Consultez votre espace rider."/>}
    {reservation && <><div className="reference-pill">Référence · <strong>{reservation.reference}</strong></div><div className="recap-card confirmation-recap"><h2>Votre session</h2><div className="summary-row"><span>Date</span><strong>{dateLabel(reservation.date)}</strong></div><div className="summary-row"><span>Lieu</span><strong>{reservation.city} · {reservation.locationName}</strong></div><div className="summary-row"><span>Horaire</span><strong>{reservation.startTime} – {reservation.endTime}</strong></div><div className="summary-row"><span>Durée</span><strong>{durationName(reservation.durationMinutes)}</strong></div><div className="summary-row"><span>Trottinette</span><strong>{reservation.scooterCount} véhicule{reservation.scooterCount>1?'s':''}</strong></div><div className="summary-row"><span>Montant</span><strong>{money(reservation.amountXof)}</strong></div><div className="recap-divider"/><span className="eyebrow">POINT DE RENDEZ-VOUS</span><p className="meeting-detail">{reservation.meetingPoint}</p><small>{reservation.address}</small></div>
      {reservation.paymentStatus !== 'paid' && <div className="payment-panel"><span className="eyebrow">MOYEN DE PAIEMENT</span><div className="choice-chips payment-methods">{(settingsQ.data?.paymentMethods ?? ['mtn_momo','moov_money']).map(m=><button className={`choice-chip ${method===m?'selected':''}`} onClick={()=>setMethod(m as typeof method)} key={m} data-testid={`button-payment-${m}`}>{m==='mtn_momo'?'MTN MoMo':'Moov Money'}</button>)}</div><Label htmlFor="phoneNumber">Numéro de téléphone</Label><Input id="phoneNumber" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+229 97 00 00 00" data-testid="input-payment-phone"/>{checkout.isError&&<ErrorPanel text="Le paiement n’a pas pu démarrer. Vérifiez le numéro puis réessayez."/>}<button onClick={pay} disabled={checkout.isPending||phone.trim().length<8} className="button-primary full" data-testid="button-pay">{checkout.isPending?'Ouverture du paiement…':`Payer ${money(reservation.amountXof)}`}<ArrowRight size={16}/></button></div>}
      <div className="confirmation-actions"><Link href="/account/reservations" className="button-outline" data-testid="link-my-bookings">Voir mes réservations <ArrowRight size={16}/></Link><button className="text-link" onClick={()=>setLocation('/reserve')} data-testid="button-book-another">Réserver une autre session</button></div>
    </>}
  </div></Shell>;
}

function SignedInPrompt({ title = 'Connectez-vous pour retrouver vos réservations.' }: { title?: string }) { return <div className="empty-route"><div className="eyebrow red-text">ESPACE RIDER</div><h1>{title}</h1><p>Votre compte garde vos créneaux, références et suivis de départ au même endroit.</p><Link href="/sign-in" className="button-primary" data-testid="link-account-login">Se connecter <ArrowRight size={16}/></Link></div>; }
function MyReservationsPage() {
  return <Shell><Show when="signed-out"><SignedInPrompt/></Show><Show when="signed-in"><MyReservationsContent/></Show></Shell>;
}
function MyReservationsContent() {
  const q=useListMyReservations();
  return <div className="content-page"><div className="page-heading"><span className="eyebrow">ESPACE RIDER</span><h1>Mes réservations<span className="red-period">.</span></h1><p>Vos prochains départs, au même endroit.</p></div>{q.isLoading?<Loading label="Chargement de vos réservations…"/>:q.isError?<ErrorPanel retry={()=>q.refetch()} text="Impossible de charger vos réservations. Connectez-vous puis réessayez."/>:q.data?.length?<div className="reservation-list">{q.data.map(r=><ReservationCard key={r.id} reservation={r}/>)}</div>:<Empty title="Pas encore de départ au programme." detail="Les réservations que vous validez apparaîtront ici."/>}</div>;
}
function Countdown({ reservation }: { reservation: Reservation }) {
  const [now,setNow]=useState(Date.now()); useEffect(()=>{const i=window.setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(i)},[]);
  const start=new Date(`${reservation.date}T${reservation.startTime}:00`).getTime(), delta=Math.max(0,start-now);
  const days=Math.floor(delta/86400000), hours=Math.floor(delta%86400000/3600000), mins=Math.floor(delta%3600000/60000), sec=Math.floor(delta%60000/1000);
  return <div className="ride-countdown" data-testid={`countdown-${reservation.id}`}><span>{delta ? 'DÉPART DANS' : 'CRÉNEAU EN COURS'}</span><strong>{days?`${days}j `:''}{String(hours).padStart(2,'0')}:{String(mins).padStart(2,'0')}:{String(sec).padStart(2,'0')}</strong></div>;
}
function ReservationCard({reservation:r}:{reservation:Reservation}) {
  const active = ['confirmed','in_progress'].includes(r.bookingStatus);
  return <article className="reservation-card" data-testid={`card-reservation-${r.id}`}><div className="reservation-date"><strong>{new Intl.DateTimeFormat('fr-FR',{day:'2-digit'}).format(new Date(`${r.date}T12:00:00`))}</strong><span>{new Intl.DateTimeFormat('fr-FR',{month:'short'}).format(new Date(`${r.date}T12:00:00`)).replace('.','')}</span></div><div className="reservation-info"><span className="eyebrow">{r.reference}</span><h2>{r.city} · {r.locationName}</h2><p><CalendarDays size={14}/>{dateLabel(r.date)} <span /> <Clock3 size={14}/>{r.startTime}–{r.endTime}</p><div className="reservation-status"><span className={`status-dot ${r.bookingStatus}`}/>{r.bookingStatus.replaceAll('_',' ')} · {r.paymentStatus.replaceAll('_',' ')}</div></div>{active&&<Countdown reservation={r}/>}<Link href={`/account/reservations/${r.id}`} className="button-outline compact" data-testid={`link-reservation-${r.id}`}>Détails <ArrowRight size={15}/></Link></article>;
}
function ReservationDetailPage() {
  return <Shell><Show when="signed-out"><SignedInPrompt/></Show><Show when="signed-in"><ReservationDetailContent/></Show></Shell>;
}
function ReservationDetailContent() {
  const [,params]=useRoute('/account/reservations/:id'), id=params?.id??'', q=useGetMyReservation(id,{query:{enabled:!!id,queryKey:getGetMyReservationQueryKey(id)}}), cancel=useCancelMyReservation();
  const qc=useQueryClient(),r=q.data;
  const onCancel=()=>{if(!r||!window.confirm('Annuler cette réservation ?'))return;cancel.mutate({id:r.id},{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetMyReservationQueryKey(id)});qc.invalidateQueries({queryKey:getListMyReservationsQueryKey()});qc.invalidateQueries({queryKey:getGetAvailabilityQueryKey()})}})};
  return <div className="content-page"><Link href="/account/reservations" className="back-link" data-testid="link-back-reservations"><ArrowLeft size={15}/> Toutes mes réservations</Link>{q.isLoading?<Loading/>:q.isError?<ErrorPanel retry={()=>q.refetch()}/>:r?<><div className="page-heading"><span className="eyebrow">{r.reference}</span><h1>{r.city} <em>· {r.locationName}</em></h1><p>{dateLabel(r.date)} · {r.startTime}–{r.endTime}</p></div>{['confirmed','in_progress'].includes(r.bookingStatus)&&<Countdown reservation={r}/>}<div className="detail-grid"><div className="recap-card"><h2>Détails du départ</h2><div className="summary-row"><span>Adresse</span><strong>{r.address}</strong></div><div className="summary-row"><span>Rendez-vous</span><strong>{r.meetingPoint}</strong></div><div className="summary-row"><span>Durée</span><strong>{durationName(r.durationMinutes)}</strong></div><div className="summary-row"><span>Véhicules</span><strong>{r.scooterCount}</strong></div><div className="summary-row"><span>Montant</span><strong>{money(r.amountXof)}</strong></div><div className="summary-row"><span>Paiement</span><strong>{r.paymentStatus.replaceAll('_',' ')}</strong></div></div><div className="detail-side"><div className="status-card"><span className={`status-dot ${r.bookingStatus}`}/><strong>{r.bookingStatus.replaceAll('_',' ')}</strong><p>Référence {r.reference}</p></div>{!['cancelled','completed','expired'].includes(r.bookingStatus)&&<button className="button-danger-outline" disabled={cancel.isPending} onClick={onCancel} data-testid="button-cancel-reservation">{cancel.isPending?'Annulation…':'Annuler cette réservation'}</button>}{cancel.isError&&<ErrorPanel text="Cette réservation ne peut pas être annulée pour le moment."/>}</div></div></>:null}</div>;
}

function AdminLayout({title,subtitle,children}:{title:string;subtitle:string;children:ReactNode}) { return <Shell admin><div className="admin-wrap"><aside className="admin-rail"><span className="eyebrow">OPÉRATIONS</span><Link href="/admin" data-testid="link-admin-dashboard">Vue d’ensemble</Link><Link href="/admin/sessions" data-testid="link-admin-sidebar-sessions">Sessions</Link><Link href="/admin/locations" data-testid="link-admin-sidebar-locations">Lieux</Link><Link href="/admin/reservations" data-testid="link-admin-sidebar-reservations">Réservations</Link><Link href="/admin/settings" data-testid="link-admin-sidebar-settings">Tarifs & règles</Link><Link href="/admin/users" data-testid="link-admin-sidebar-users">Utilisateurs</Link></aside><div className="admin-content"><div className="page-heading"><span className="eyebrow">GLOW-RIDE / ADMIN</span><h1>{title}<span className="red-period">.</span></h1><p>{subtitle}</p></div>{children}</div></div></Shell>; }
function AdminGuard({ children }: { children: ReactNode }) {
  const profile = useGetMyProfile({ query: { queryKey: getGetMyProfileQueryKey() } });
  return <Show when="signed-in">{profile.isLoading ? <Shell><Loading label="Vérification des accès…"/></Shell> : profile.isError ? <Shell><ErrorPanel text="Impossible de vérifier votre profil." retry={() => profile.refetch()}/></Shell> : profile.data?.role === 'admin' ? <>{children}</> : <Shell><div className="empty-route"><span className="eyebrow red-text">ACCÈS RESTREINT</span><h1>Cette console est réservée à l’équipe opérationnelle.</h1><p>Le rôle associé à votre compte est rider. Contactez un administrateur si cet accès est nécessaire.</p><Link href="/account/reservations" className="button-outline" data-testid="link-return-rider">Retour à mon espace</Link></div></Shell>}</Show>;
}
function AdminSignedOut() { return <Show when="signed-out"><Shell><SignedInPrompt title="Connectez-vous avec un compte administrateur."/></Shell></Show>; }
function GuardedAdminOverview() { return <><AdminSignedOut/><AdminGuard><AdminOverviewPage/></AdminGuard></>; }
function GuardedAdminSessions() { return <><AdminSignedOut/><AdminGuard><AdminSessionsPage/></AdminGuard></>; }
function GuardedAdminLocations() { return <><AdminSignedOut/><AdminGuard><AdminLocationsPage/></AdminGuard></>; }
function GuardedAdminReservations() { return <><AdminSignedOut/><AdminGuard><AdminReservationsPage/></AdminGuard></>; }
function GuardedAdminSettings() { return <><AdminSignedOut/><AdminGuard><AdminSettingsPage/></AdminGuard></>; }
function GuardedAdminUsers() { return <><AdminSignedOut/><AdminGuard><AdminUsersPage/></AdminGuard></>; }
function AdminOverviewPage() {
  const q=useGetAdminOverview();
  return <AdminLayout title="Tableau de bord" subtitle="Le mouvement opérationnel, aujourd’hui.">{q.isLoading?<Loading/>:q.isError?<ErrorPanel retry={()=>q.refetch()}/>:q.data?<><div className="metrics-grid">{[['Réservations du jour',q.data.todayReservations],['Paiements en attente',q.data.pendingPayments],['Trottinettes en route',q.data.scootersInUse],['Sessions à venir',q.data.upcomingSessions]].map(([a,b])=><div className="metric-card" key={a}><span>{a}</span><strong>{b}</strong><i><ArrowUpRight size={16}/></i></div>)}</div><div className="revenue-card"><div><span className="eyebrow">RECETTES DU JOUR</span><strong>{money(q.data.revenueTodayXof)}</strong></div><div className="revenue-chart"><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/></div></div><div className="table-section"><div className="table-heading"><h2>Réservations récentes</h2><Link href="/admin/reservations" className="text-link">Tout voir <ArrowRight size={15}/></Link></div><ReservationsTable rows={q.data.recentReservations}/></div></>:null}</AdminLayout>;
}
function ReservationsTable({rows}:{rows:Reservation[]}) { return rows.length?<div className="table-scroll"><table><thead><tr><th>Référence</th><th>Client / date</th><th>Lieu</th><th>État</th><th>Montant</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} data-testid={`row-reservation-${r.id}`}><td><strong>{r.reference}</strong><small>{r.startTime} · {r.scooterCount} véhicule(s)</small></td><td>{dateLabel(r.date)}<small>{r.userId}</small></td><td>{r.city}<small>{r.locationName}</small></td><td><span className={`status-badge ${r.bookingStatus}`}>{r.bookingStatus.replaceAll('_',' ')}</span></td><td>{money(r.amountXof)}</td></tr>)}</tbody></table></div>:<Empty title="Aucune réservation ici." detail="Les réservations apparaîtront dès qu’un rider aura choisi une session."/>; }
function AdminReservationsPage() {
  const [status,setStatus]=useState(''),q=useListAdminReservations(status?{status:status as any}:{}),update=useUpdateAdminReservation(),qc=useQueryClient();
  const change=(id:string,v:string)=>update.mutate({id,data:{bookingStatus:v as 'confirmed'|'in_progress'|'completed'|'cancelled'}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListAdminReservationsQueryKey(status?{status:status as any}:{})});qc.invalidateQueries({queryKey:getGetAdminOverviewQueryKey()})}});
  return <AdminLayout title="Réservations" subtitle="Suivez et mettez à jour les départs."><div className="toolbar"><label>État<select value={status} onChange={e=>setStatus(e.target.value)} data-testid="select-reservation-status"><option value="">Tous les états</option>{['pending_payment','confirmed','in_progress','completed','cancelled','expired'].map(s=><option key={s}>{s}</option>)}</select></label></div>{q.isLoading?<Loading/>:q.isError?<ErrorPanel retry={()=>q.refetch()}/>:<div className="table-section"><ReservationsTable rows={q.data??[]}/>{(q.data??[]).map(r=><div className="admin-row-action" key={r.id}><span>{r.reference} · {r.bookingStatus}</span><select value={r.bookingStatus} onChange={e=>change(r.id,e.target.value)} aria-label={`État de ${r.reference}`} data-testid={`select-booking-${r.id}`}>{['confirmed','in_progress','completed','cancelled'].map(s=><option key={s}>{s}</option>)}</select></div>)}</div>}</AdminLayout>;
}
function AdminLocationsPage() {
  const q=useListAdminLocations(),create=useCreateLocation(),update=useUpdateLocation(),remove=useDeleteLocation(),qc=useQueryClient();
  const form=useForm({defaultValues:{city:'',name:'',address:'',meetingPoint:''}});
  const refresh=()=>{qc.invalidateQueries({queryKey:getListAdminLocationsQueryKey()});qc.invalidateQueries({queryKey:getListAdminSessionsQueryKey()});qc.invalidateQueries({queryKey:getListSessionsQueryKey()})};
  const edit=(location: NonNullable<typeof q.data>[number])=>{const city=window.prompt('Ville',location.city);if(city===null)return;const name=window.prompt('Nom du lieu',location.name);if(name===null)return;const address=window.prompt('Adresse',location.address);if(address===null)return;const meetingPoint=window.prompt('Point de rendez-vous',location.meetingPoint);if(meetingPoint===null)return;update.mutate({id:location.id,data:{city:city.trim()||location.city,name:name.trim()||location.name,address:address.trim()||location.address,meetingPoint:meetingPoint.trim()||location.meetingPoint}},{onSuccess:refresh})};
  return <AdminLayout title="Lieux" subtitle="Réutilisez des adresses : elles ne deviennent disponibles qu’une fois associées à une session."><Form {...form}><form className="admin-form" onSubmit={form.handleSubmit(v=>create.mutate({data:v},{onSuccess:()=>{form.reset();refresh()}}))}><h2>Ajouter un lieu réutilisable</h2><div className="form-grid">{(['city','name','address','meetingPoint'] as const).map(k=><FormField key={k} control={form.control} name={k} render={({field})=><FormItem><FormLabel>{({city:'Ville',name:'Nom du lieu',address:'Adresse',meetingPoint:'Point de rendez-vous'} as const)[k]}</FormLabel><FormControl><Input {...field} required data-testid={`input-location-${k}`}/></FormControl></FormItem>}/>)}</div><button className="button-primary" disabled={create.isPending} data-testid="button-create-location">{create.isPending?'Enregistrement…':'Ajouter le lieu'} <Plus size={15}/></button></form></Form>
    {(update.isError||remove.isError)&&<ErrorPanel text="La modification du lieu n’a pas abouti."/>}{create.isError&&<ErrorPanel text="Impossible de créer ce lieu."/>}{q.isLoading?<Loading/>:q.isError?<ErrorPanel retry={()=>q.refetch()}/>:<div className="location-admin-list">{(q.data??[]).map(l=><article className="admin-entity" key={l.id} data-testid={`location-${l.id}`}><div><span className="eyebrow">{l.city}</span><h3>{l.name}</h3><p>{l.address}</p><small>Rendez-vous : {l.meetingPoint}</small></div><div className="entity-actions"><span className={`status-badge ${l.active?'confirmed':'cancelled'}`}>{l.active?'Actif':'Archivé'}</span><button className="button-outline compact" onClick={()=>edit(l)} data-testid={`button-edit-location-${l.id}`}>Modifier</button><button className="button-outline compact" onClick={()=>update.mutate({id:l.id,data:{active:!l.active}},{onSuccess:refresh})} data-testid={`button-toggle-location-${l.id}`}>{l.active?'Désactiver':'Activer'}</button><button className="button-danger-outline compact" onClick={()=>{if(window.confirm(`Supprimer ${l.name} ?`))remove.mutate({id:l.id},{onSuccess:refresh})}} data-testid={`button-delete-location-${l.id}`}>Supprimer</button></div></article>)}</div>}</AdminLayout>;
}
function AdminSessionsPage() {
  const locationsQ=useListAdminLocations(),q=useListAdminSessions({}),create=useCreateSession(),update=useUpdateSession(),remove=useDeleteSession(),qc=useQueryClient();
  const form=useForm({defaultValues:{locationId:'',date:new Date().toISOString().slice(0,10),opensAt:'16:00',closesAt:'20:00',scooterCount:8,durationsMinutes:'30,60,120'}});
  const refresh=()=>{qc.invalidateQueries({queryKey:getListAdminSessionsQueryKey({})});qc.invalidateQueries({queryKey:getListSessionsQueryKey()});qc.invalidateQueries({queryKey:getGetAvailabilityQueryKey()})};
  const edit=(session: NonNullable<typeof q.data>[number])=>{const date=window.prompt('Date (AAAA-MM-JJ)',session.date);if(date===null)return;const opensAt=window.prompt('Heure d’ouverture (HH:MM)',session.opensAt);if(opensAt===null)return;const closesAt=window.prompt('Heure de fermeture (HH:MM)',session.closesAt);if(closesAt===null)return;const stock=window.prompt('Stock de trottinettes',String(session.scooterCount));if(stock===null)return;const durations=window.prompt('Durées en minutes, séparées par virgule',session.durationsMinutes.join(','));if(durations===null)return;update.mutate({id:session.id,data:{date,opensAt,closesAt,scooterCount:Number(stock),durationsMinutes:durations.split(',').map(x=>Number(x.trim())).filter(Boolean)}},{onSuccess:refresh})};
  return <AdminLayout title="Sessions" subtitle="Planifiez la présence de Glow Ride, son stock et ses horaires."><Form {...form}><form className="admin-form" onSubmit={form.handleSubmit(v=>create.mutate({data:{...v,scooterCount:Number(v.scooterCount),durationsMinutes:v.durationsMinutes.split(',').map(x=>Number(x.trim())).filter(Boolean)}},{onSuccess:()=>{form.reset({locationId:'',date:new Date().toISOString().slice(0,10),opensAt:'16:00',closesAt:'20:00',scooterCount:8,durationsMinutes:'30,60,120'});refresh()}}))}><h2>Publier une session</h2><div className="form-grid"><FormField control={form.control} name="locationId" render={({field})=><FormItem><FormLabel>Lieu du rendez-vous</FormLabel><FormControl><select {...field} required data-testid="select-session-location"><option value="">Choisir un lieu</option>{(locationsQ.data??[]).filter(l=>l.active).map(l=><option value={l.id} key={l.id}>{l.city} · {l.name}</option>)}</select></FormControl></FormItem>}/><FormField control={form.control} name="date" render={({field})=><FormItem><FormLabel>Date</FormLabel><FormControl><Input type="date" {...field} required data-testid="input-session-date"/></FormControl></FormItem>}/><FormField control={form.control} name="opensAt" render={({field})=><FormItem><FormLabel>Ouverture</FormLabel><FormControl><Input type="time" {...field} data-testid="input-session-opens"/></FormControl></FormItem>}/><FormField control={form.control} name="closesAt" render={({field})=><FormItem><FormLabel>Fermeture</FormLabel><FormControl><Input type="time" {...field} data-testid="input-session-closes"/></FormControl></FormItem>}/><FormField control={form.control} name="scooterCount" render={({field})=><FormItem><FormLabel>Stock scooters</FormLabel><FormControl><Input type="number" min="1" max="100" {...field} data-testid="input-session-stock"/></FormControl></FormItem>}/><FormField control={form.control} name="durationsMinutes" render={({field})=><FormItem><FormLabel>Durées en minutes</FormLabel><FormControl><Input {...field} placeholder="30, 60, 120" data-testid="input-session-durations"/></FormControl></FormItem>}/></div><button className="button-primary" disabled={create.isPending||!locationsQ.data?.length} data-testid="button-create-session">{create.isPending?'Publication…':'Publier la session'} <Plus size={15}/></button>{!locationsQ.data?.length&&<small>Ajoutez d’abord un lieu réutilisable.</small>}</form></Form>{create.isError&&<ErrorPanel text="La session n’a pas pu être publiée."/>}
    {(update.isError||remove.isError)&&<ErrorPanel text="La mise à jour de la session n’a pas abouti."/>}{q.isLoading?<Loading/>:q.isError?<ErrorPanel retry={()=>q.refetch()}/>:<div className="location-admin-list">{(q.data??[]).map(s=><article className="admin-entity" key={s.id} data-testid={`session-${s.id}`}><div className="entity-date"><strong>{shortDate(s.date)}</strong><span>{s.date}</span></div><div><span className="eyebrow">{s.city}</span><h3>{s.locationName}</h3><p>{s.address} · {s.meetingPoint}</p><small>{s.opensAt}–{s.closesAt} · {s.scooterCount} scooters · {s.durationsMinutes.map(durationName).join(', ')}</small></div><div className="entity-actions"><span className={`status-badge ${s.active?'confirmed':'cancelled'}`}>{s.active?'Publiée':'Inactive'}</span><button className="button-outline compact" onClick={()=>edit(s)} data-testid={`button-edit-session-${s.id}`}>Modifier</button><button className="button-outline compact" onClick={()=>update.mutate({id:s.id,data:{active:!s.active}},{onSuccess:refresh})} data-testid={`button-toggle-session-${s.id}`}>{s.active?'Désactiver':'Activer'}</button><button className="button-danger-outline compact" onClick={()=>{if(window.confirm('Supprimer cette session ?'))remove.mutate({id:s.id},{onSuccess:refresh})}} data-testid={`button-delete-session-${s.id}`}>Supprimer</button></div></article>)}</div>}</AdminLayout>;
}
function AdminSettingsPage() {
  const q=useGetAdminSettings(),update=useUpdateAdminSettings(),qc=useQueryClient(),form=useForm({defaultValues:{unlockFeeXof:0,pricePerMinuteXof:0,durationsMinutes:'30,60,120',maximumAdvanceDays:30,cancellationCutoffMinutes:60}});
  useEffect(()=>{if(q.data)form.reset({...q.data,durationsMinutes:q.data.durationsMinutes.join(',')})},[q.data]);
  return <AdminLayout title="Tarifs & règles" subtitle="Une grille claire, partagée avec le parcours de réservation.">{q.isLoading?<Loading/>:q.isError?<ErrorPanel retry={()=>q.refetch()}/>:<Form {...form}><form className="admin-form settings-form" onSubmit={form.handleSubmit(v=>update.mutate({data:{unlockFeeXof:Number(v.unlockFeeXof),pricePerMinuteXof:Number(v.pricePerMinuteXof),durationsMinutes:v.durationsMinutes.split(',').map(x=>Number(x.trim())).filter(Boolean),maximumAdvanceDays:Number(v.maximumAdvanceDays),cancellationCutoffMinutes:Number(v.cancellationCutoffMinutes)}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetAdminSettingsQueryKey()});qc.invalidateQueries({queryKey:getGetPublicSettingsQueryKey()})}}))}><h2>Paramètres publics</h2><p>Les modifications s’appliquent aux prochaines réservations.</p><div className="form-grid">{([['unlockFeeXof','Frais de déverrouillage (XOF)'],['pricePerMinuteXof','Prix par minute (XOF)'],['durationsMinutes','Durées disponibles (minutes, séparées par virgule)'],['maximumAdvanceDays','Réservation jusqu’à (jours à l’avance)'],['cancellationCutoffMinutes','Limite d’annulation avant départ (minutes)']] as const).map(([k,label])=><FormField key={k} control={form.control} name={k} render={({field})=><FormItem><FormLabel>{label}</FormLabel><FormControl><Input {...field} type={k==='durationsMinutes'?'text':'number'} data-testid={`input-setting-${k}`}/></FormControl></FormItem>}/>)}</div><div className="settings-methods"><span className="eyebrow">MOYENS DE PAIEMENT CONFIGURÉS</span><p>{q.data?.paymentMethods?.map(m=>m==='mtn_momo'?'MTN MoMo':'Moov Money').join(' · ')||'Aucun moyen configuré'}</p></div><button className="button-primary" disabled={update.isPending} data-testid="button-save-settings">{update.isPending?'Enregistrement…':'Enregistrer les tarifs'} <Check size={15}/></button>{update.isError&&<ErrorPanel text="Les paramètres n’ont pas pu être enregistrés."/>}</form></Form>}</AdminLayout>;
}
function AdminUsersPage() {
  const q=useListAdminUsers(),update=useUpdateAdminUserRole(),qc=useQueryClient();
  return <AdminLayout title="Utilisateurs" subtitle="Attribuez l’accès opérationnel aux comptes Glow Ride.">{q.isLoading?<Loading/>:q.isError?<ErrorPanel retry={()=>q.refetch()}/>:<div className="table-section"><div className="table-scroll"><table><thead><tr><th>Utilisateur</th><th>Compte créé</th><th>Rôle</th><th>Accès</th></tr></thead><tbody>{(q.data??[]).map(u=><tr key={u.id} data-testid={`row-user-${u.id}`}><td><strong>{u.fullName||u.email}</strong><small>{u.email}</small></td><td>{dateLabel(u.createdAt.slice(0,10))}</td><td><span className={`status-badge ${u.role==='admin'?'confirmed':''}`}>{u.role}</span></td><td><select value={u.role} onChange={e=>{if(window.confirm(`Modifier le rôle de ${u.email} ?`))update.mutate({id:u.id,data:{role:e.target.value as 'user'|'admin'}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListAdminUsersQueryKey()});qc.invalidateQueries({queryKey:getGetMyProfileQueryKey()})}})}} data-testid={`select-user-role-${u.id}`}><option value="user">Rider</option><option value="admin">Administrateur</option></select></td></tr>)}</tbody></table></div>{update.isError&&<ErrorPanel text="Le rôle n’a pas pu être modifié."/>}</div>}</AdminLayout>;
}

function App() {
  return <TooltipProvider><WouterRouter base={basePath}><ProviderRoutes/></WouterRouter></TooltipProvider>;
}
export default App;
