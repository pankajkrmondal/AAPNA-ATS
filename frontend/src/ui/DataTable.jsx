/**
 * DataTable — AntD's Table with the states built in.
 *
 * The app has 25 raw <Table> instances and ~40 raw <Spin>/<Empty> around them, each
 * deciding independently what loading, empty and failed look like. Table sizes also
 * vary per page for no stated reason — 193 `size="small"` against a configured 40px
 * default control height, which is the rollout plan's own example of "table sizes
 * and button heights vary per page for no reason".
 *
 * A table is TIER 3 — a data surface. Dense text needs a steadier ground than a hero
 * does, which is why it is more opaque than a feature card and why it does not lift
 * on hover: a 100-row table bouncing as the pointer crosses it is wrong.
 */
import { Table } from 'antd';
import Surface from './Surface';
import StateBlock from './StateBlock';

/**
 * @param {object} props
 * @param {Array} props.columns
 * @param {Array} props.dataSource
 * @param {boolean} [props.loading]
 * @param {Error|string} [props.error]
 * @param {Function} [props.onRetry]
 * @param {object} [props.empty]  { title, body, action } — see StateBlock
 * @param {'compact'|'default'|'relaxed'} [props.density]  overrides the page density
 * @param {boolean} [props.surface=true]  wrap in a tier-3 surface; false when the
 *   caller already provides one (a table inside an existing panel)
 */
export default function DataTable({
  columns,
  dataSource,
  loading = false,
  error = null,
  onRetry,
  empty,
  density,
  surface = true,
  className = '',
  ...rest
}) {
  let content;

  if (error) {
    content = (
      <StateBlock
        variant="error"
        title="This didn't load"
        // The message, not a generic apology: the reader can only act on what
        // actually failed. Falls back only when there is genuinely nothing to say.
        body={typeof error === 'string' ? error : error?.message || 'Something went wrong fetching this data.'}
        action={onRetry ? { label: 'Try again', onClick: onRetry } : undefined}
      />
    );
  } else if (loading && !dataSource?.length) {
    // Only for the FIRST load. A refetch over existing rows keeps the rows and uses
    // AntD's own overlay, because replacing populated content with a skeleton loses
    // the reader's place.
    content = <StateBlock variant="loading" rows={6} />;
  } else {
    content = (
      <Table
        columns={columns}
        dataSource={dataSource}
        loading={loading}
        className={`ui-table${className ? ` ${className}` : ''}`}
        // The empty slot is where "No data" used to live. StateBlock's shape forces
        // a reason and an action instead — see the rule quoted in that file.
        locale={{
          emptyText: (
            <StateBlock
              variant="empty"
              title={empty?.title || 'Nothing here yet'}
              body={empty?.body || 'When there is data to show, it will appear in this table.'}
              action={empty?.action}
            />
          ),
        }}
        {...rest}
      />
    );
  }

  if (!surface) return content;

  return (
    <Surface tier={3} padding="none" data-density={density} className="ui-table-surface">
      {content}
    </Surface>
  );
}
