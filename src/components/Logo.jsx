// Logo oficial da loja (arquivo em public/brand)
export default function Logo({ altura = 34, className = '' }) {
  return (
    <img
      className={`logo ${className}`}
      src="./brand/deManas-logo-principal.png"
      alt="deMana's para você"
      style={{ height: altura }}
    />
  )
}
