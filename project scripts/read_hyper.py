"""
Script for reading Hyper extracts. Works on paths directly to Hyper extracts, and also on
paths to Tableau packaged workbooks (.twbx) that contain an extract.

Currently supports extracting column names and data values from the extract.

Tableau Hyper Python API reference: https://tableau.github.io/hyper-db/lang_docs/py/tableauhyperapi.html
"""

from argparse import ArgumentParser, Namespace
from pathlib import Path
from os import walk
from os.path import join
from tempfile import TemporaryDirectory
from shutil import copy
from sys import exit
from zipfile import ZipFile
import csv

from tableauhyperapi import HyperProcess, Connection, Telemetry


def parse_arguments():
    parser = ArgumentParser(description="Convert Hyper database to CSV.")

    parser.add_argument(
        "--path",
        "-p",
        type=Path,
        required=True,
        help="Path to Hyper extract or Tableau packaged workbook",
    )

    parser.add_argument(
        "--limit",
        "-l",
        type=int,
        help="Max number of rows to include",
    )

    return parser.parse_args()


def __extract_data(path: Path, limit: int):
    with HyperProcess(Telemetry.DO_NOT_SEND_USAGE_DATA_TO_TABLEAU, 'csv_extractor') as hyper:
        with Connection(hyper.endpoint, path) as connection:
            catalog = connection.catalog
            schemas = catalog.get_schema_names()

            for schema in schemas:
                tables = catalog.get_table_names(schema)

                for table in tables:
                    with open(f"{table}.csv", "w", encoding="utf-8") as csv_file:
                        writer = csv.writer(csv_file)

                        # Column names
                        table_def = catalog.get_table_definition(table)
                        writer.writerow([col.name.unescaped for col in table_def.columns])

                        # Row values
                        with connection.execute_query(f'SELECT * FROM {table}') as result:
                            rows = list(result)

                            if isinstance(limit, int) and limit > 0:
                                rows = rows[:limit]

                            writer.writerows(rows)


def main(args: Namespace):
    if not args.path.is_file():
        print(f"\n{args.path} does not exist.")
        exit(1)

    if args.path.suffix not in (".hyper", ".twbx"):
        print(f"\n{args.path} is not a Hyper extract or Tableau packaged workbook.")
        exit(1)

    if args.path.suffix == ".twbx":
        # Uncompress the packaged workbook and retrieve the hyper file if it exists
        with TemporaryDirectory() as tmp_dir:
            dst = copy(args.path, tmp_dir)
            with ZipFile(dst, "r") as zip_ref:
                zip_ref.extractall(tmp_dir)

            hyper_paths = []

            for root, _, files in walk(tmp_dir, topdown=False):
                for name in files:
                    p = Path(join(root, name))
                    if p.suffix == ".hyper":
                        hyper_paths.append(p)

            if len(hyper_paths) == 0:
                print(f"\nNo Hyper extracts found in {args.path}.")
                exit(1)

            for hyper_path in hyper_paths:
                __extract_data(hyper_path, args.limit)
    elif args.path.suffix == ".hyper":
        __extract_data(args.path, args.limit)
    else:
        raise NotImplementedError


if __name__ == "__main__":
    main(parse_arguments())
