"""
Dataset YAML Parser

This script processes YAML files containing datasource field definitions and converts
them into CSV format where field names become columns and field values become rows.
This is useful for analyzing and visualizing dataset schemas.

Usage:
    python dataset-yaml-parser.py

Author: Research Team
"""

import yaml
import pandas as pd

def process_yaml_to_csv(input_file_path: str, output_file_path: str) -> None:
    """
    Process a YAML file containing datasource fields and convert to CSV format.
    
    The YAML file should contain a "datasourceFields" array with field definitions.
    Each field should have a "name" and optional "fieldValues" array. The function
    reshapes this data so that field names become columns and field values become rows.
    
    Args:
        input_file_path (str): Path to the input YAML file containing datasource fields
        output_file_path (str): Path where the output CSV file will be saved
        
    Raises:
        FileNotFoundError: If the input YAML file doesn't exist
        yaml.YAMLError: If the YAML file is malformed
        KeyError: If required "datasourceFields" key is missing
    """
    # Load and parse the YAML content
    with open(input_file_path, 'r') as file:
        yaml_content = yaml.safe_load(file)

    # Extract the datasource fields array from the YAML content
    datasource_fields = yaml_content.get("datasourceFields", [])

    # Reshape data structure: field names become columns, field values become rows
    reshaped_data = {}

    # Process each field definition and extract name and values
    for field in datasource_fields:
        field_name = field["name"]
        field_values = field.get("fieldValues", [])
        reshaped_data[field_name] = field_values

    # Convert reshaped data to a pandas DataFrame
    # Transpose to align field names as columns and values as rows
    reshaped_df = pd.DataFrame.from_dict(reshaped_data, orient="index").transpose()

    # Save the reshaped DataFrame as CSV file
    reshaped_df.to_csv(output_file_path, index=False)
    print(f"CSV file saved to {output_file_path}")

# Example usage with hardcoded paths
# Note: Update these paths according to your local setup
input_yaml_path = "/path/to/your/datasource.yaml"
output_csv_path = "dataset.csv"

if __name__ == "__main__":
    process_yaml_to_csv(input_yaml_path, output_csv_path)
