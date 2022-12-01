import React, { useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Select,
  Space,
  Input,
  Checkbox,
  message,
  Menu,
  Dropdown,
  Alert,
  Tooltip,
  Result
} from 'antd'
import {
  LoadingOutlined,
  ExportOutlined,
  MenuOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons'
import { ScrollablePane } from 'office-ui-fabric-react/lib/ScrollablePane'

import {
  Card,
  ColumnsSelector,
  TimeRangeSelector,
  Toolbar,
  MultiSelect,
  TimeRange,
  toTimeRangeValue,
  IColumnKeys
} from '@lib/components'
import { CacheContext } from '@lib/utils/useCache'
import { useVersionedLocalStorageState } from '@lib/utils/useVersionedLocalStorageState'
import SlowQueriesTable from '../../components/SlowQueriesTable'
import useSlowQueryTableController, {
  DEF_SLOW_QUERY_COLUMN_KEYS,
  DEF_SLOW_QUERY_OPTIONS
} from '../../utils/useSlowQueryTableController'
import styles from './List.module.less'
import { useDebounceFn, useMemoizedFn } from 'ahooks'
import { useDeepCompareChange } from '@lib/utils/useChange'
import { isDistro } from '@lib/utils/distro'
import { SlowQueryContext } from '../../context'
import { SlowQueryScatterChart } from './ScatterChart'
import { Selections, useUrlSelection } from './Selections'

const { Option } = Select

const SLOW_QUERY_VISIBLE_COLUMN_KEYS = 'slow_query.visible_column_keys'
const SLOW_QUERY_SHOW_FULL_SQL = 'slow_query.show_full_sql'
const LIMITS = [100, 200, 500, 1000]

function List() {
  const { t } = useTranslation()

  const ctx = useContext(SlowQueryContext)

  const cacheMgr = useContext(CacheContext)

  const [urlSelection, setUrlSelection] = useUrlSelection()

  const [visibleColumnKeys, setVisibleColumnKeys] =
    useVersionedLocalStorageState(SLOW_QUERY_VISIBLE_COLUMN_KEYS, {
      defaultValue: DEF_SLOW_QUERY_COLUMN_KEYS
    })
  const [showFullSQL, setShowFullSQL] = useVersionedLocalStorageState(
    SLOW_QUERY_SHOW_FULL_SQL,
    { defaultValue: false }
  )
  const [downloading, setDownloading] = useState(false)

  const controller = useSlowQueryTableController({
    cacheMgr,
    showFullSQL,
    fetchSchemas: ctx?.cfg.showDBFilter,
    initialQueryOptions: {
      ...DEF_SLOW_QUERY_OPTIONS,
      visibleColumnKeys
    },

    ds: ctx!.ds
  })
  function updateVisibleColumnKeys(v: IColumnKeys) {
    setVisibleColumnKeys(v)
    if (!v[controller.orderOptions.orderBy]) {
      controller.resetOrder()
    }
  }

  function menuItemClick({ key }) {
    switch (key) {
      case 'export':
        const hide = message.loading(
          t('slow_query.toolbar.exporting') + '...',
          0
        )
        downloadCSV().finally(hide)
        break
    }
  }

  const dropdownMenu = (
    <Menu onClick={menuItemClick}>
      <Menu.Item
        key="export"
        disabled={downloading}
        icon={<ExportOutlined />}
        data-e2e="slow_query_export_btn"
      >
        {downloading
          ? t('slow_query.toolbar.exporting')
          : t('slow_query.toolbar.export')}
      </Menu.Item>
    </Menu>
  )

  const [timeRange, setTimeRange] = useState<TimeRange>(
    controller.queryOptions.timeRange
  )
  const [filterSchema, setFilterSchema] = useState<string[]>(
    controller.queryOptions.schemas
  )
  const [filterLimit, setFilterLimit] = useState<number>(
    controller.queryOptions.limit
  )
  const [filterText, setFilterText] = useState<string>(
    controller.queryOptions.searchText
  )

  const sendQueryNow = useMemoizedFn(() => {
    cacheMgr?.clear()
    controller.setQueryOptions({
      timeRange,
      schemas: filterSchema,
      limit: filterLimit,
      searchText: filterText,
      visibleColumnKeys,
      digest: '',
      plans: []
    })
  })

  const sendQueryDebounced = useDebounceFn(sendQueryNow, {
    wait: 300
  }).run

  useDeepCompareChange(() => {
    if (
      controller.isDataLoadedSlowly || // if data was loaded slowly
      controller.isDataLoadedSlowly === null // or a request is not yet finished (which means slow network)..
    ) {
      // do not send requests on-the-fly.
      return
    }
    sendQueryDebounced()
  }, [timeRange, filterSchema, filterLimit, filterText, visibleColumnKeys])

  const downloadCSV = useMemoizedFn(async () => {
    // use last effective query options
    const timeRangeValue = toTimeRangeValue(controller.queryOptions.timeRange)
    try {
      setDownloading(true)
      const res = await ctx!.ds.slowQueryDownloadTokenPost({
        fields: '*',
        begin_time: timeRangeValue[0],
        end_time: timeRangeValue[1],
        db: controller.queryOptions.schemas,
        text: controller.queryOptions.searchText,
        orderBy: controller.orderOptions.orderBy,
        desc: controller.orderOptions.desc,
        limit: 10000,
        digest: '',
        plans: []
      })
      const token = res.data
      if (token) {
        window.location.href = `${
          ctx!.cfg.apiPathBase
        }/slow_query/download?token=${token}`
      }
    } finally {
      setDownloading(false)
    }
  })

  return (
    <div className={styles.list_container}>
      <Card>
        <h1 style={{ marginBottom: '36px' }}>Slow Query Profiler</h1>
        <Selections
          timeRange={timeRange}
          selection={urlSelection}
          onSelectionChange={setUrlSelection}
          onTimeRangeChange={setTimeRange}
        />
        <div style={{ height: '300px' }}>
          <SlowQueryScatterChart displayOptions={urlSelection} />
        </div>
      </Card>

      {controller.data?.length === 0 ? (
        <Result title={t('slow_query.overview.empty_result')} />
      ) : (
        <div style={{ height: '100%', position: 'relative' }}>
          {controller.isDataLoadedSlowly && (
            <Card noMarginBottom noMarginTop>
              <Alert
                message={t('slow_query.overview.slow_load_info')}
                type="info"
                showIcon
              />
            </Card>
          )}
          <Card noMarginBottom noMarginTop>
            <Toolbar className={styles.list_toolbar}>
              <Space>
                <div>
                  {(controller.data?.length ?? 0) > 0 && (
                    <p className="ant-form-item-extra">
                      {t('slow_query.overview.result_count', {
                        n: controller.data?.length
                      })}
                    </p>
                  )}
                </div>
              </Space>

              <Space>
                {controller.availableColumnsInTable.length > 0 && (
                  <ColumnsSelector
                    columns={controller.availableColumnsInTable}
                    visibleColumnKeys={visibleColumnKeys}
                    defaultVisibleColumnKeys={DEF_SLOW_QUERY_COLUMN_KEYS}
                    onChange={updateVisibleColumnKeys}
                    foot={
                      <Checkbox
                        checked={showFullSQL}
                        onChange={(e) => setShowFullSQL(e.target.checked)}
                        data-e2e="slow_query_show_full_sql"
                      >
                        {t('slow_query.toolbar.select_columns.show_full_sql')}
                      </Checkbox>
                    }
                  />
                )}
              </Space>
            </Toolbar>
          </Card>
          <div style={{ height: '100%', position: 'relative' }}>
            <ScrollablePane>
              <SlowQueriesTable cardNoMarginTop controller={controller} />
            </ScrollablePane>
          </div>
        </div>
      )}
    </div>
  )
}

export default List