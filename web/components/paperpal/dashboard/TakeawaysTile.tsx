import { Tile, TileHeader } from "../primitives";

export function TakeawaysTile({ takeaways }: { takeaways: string[] }) {
  return (
    <Tile id="section-takeaways" className="pp-col-12">
      <TileHeader
        title="Key takeaways"
        accent
        count={`${takeaways.length} insights`}
      />
      <div className="pp-takeaways">
        {takeaways.map((t, i) => (
          <div className="pp-takeaway" key={i}>
            <div className="pp-takeaway-num">{String(i + 1).padStart(2, "0")}</div>
            <p>{t}</p>
          </div>
        ))}
      </div>
    </Tile>
  );
}
