// Ícones de traço fino, desenhados à mão para combinar com a marca
const caminhos = {
  inicio: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></>,
  vender: <><path d="M6 7h12l-1 13H7L6 7Z" /><path d="M9 7a3 3 0 0 1 6 0" /></>,
  vendas: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  produtos: <><path d="M3 12V4h8l10 10-8 8L3 12Z" /><circle cx="7.5" cy="8.5" r="1.5" /></>,
  estoque: <><path d="M3 8 12 3l9 5v9l-9 5-9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v9" /></>,
  clientes: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>,
  relatorios: <><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></>,
  financeiro: <><circle cx="12" cy="12" r="9" /><path d="M14.8 9.2c-.5-.8-1.5-1.3-2.8-1.3-1.7 0-2.8.8-2.8 2s1.1 1.7 2.8 2 2.8.9 2.8 2.1-1.2 2-2.8 2c-1.3 0-2.4-.5-2.9-1.4M12 6.5v11" /></>,
  fiscal: <><path d="M6 3h9l4 4v14H6V3Z" /><path d="M14 3v5h5M9 13h7M9 17h5" /></>,
  encomenda: <><path d="M3 8 12 3l9 5v5" /><path d="m3 8 9 5 9-5M12 13v8l-9-5V8" /><circle cx="18" cy="18" r="4" /><path d="M18 16.3V18l1.2 1" /></>,
  calculadora:<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01" /></>,
  configuracoes:<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  mais: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  fechar: <><path d="M6 6l12 12M18 6 6 18" /></>,
  sol: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  lua: <><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" /></>,
  sair: <><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></>,
  cadeado: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  busca: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  somar: <><path d="M12 5v14M5 12h14" /></>,
  subtrair: <><path d="M5 12h14" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4V8Z" /><circle cx="12" cy="13" r="3.5" /></>,
  conversa: <><path d="M4 19.5 5.3 16A8 8 0 1 1 8 18.7L4 19.5Z" /></>,
  alerta: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4M12 17v.01" /></>,
  confirmar: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  voltar: <><path d="M15 5l-7 7 7 7" /></>,
  seguir: <><path d="M9 5l7 7-7 7" /></>,
  presente: <><rect x="3.5" y="8" width="17" height="4" /><path d="M5 12v9h14v-9M12 8v13M12 8S10.5 3.5 8 4.5 9 8 12 8ZM12 8s1.5-4.5 4-3.5S15 8 12 8Z" /></>,
  relogio: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  baixar: <><path d="M12 4v11M7 10l5 5 5-5M4 20h16" /></>,
  lixo: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>,
}

export default function Icone({ nome, tamanho = 22, className = '' }) {
  return (
    <svg
      className={`icone ${className}`}
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {caminhos[nome]}
    </svg>
  )
}
